/**
 * Live sessions: ask a running engine questions.
 *
 * A sealed run answers "what did the engine render", after the fact. While
 * debugging, the AI often needs the engine's own view instead -- "where is
 * object 7, is it culled, what is its material" -- and the freedom to pause,
 * step a frame, and look again. A session provides that, and is built so it
 * can never be mistaken for evidence:
 *
 *   - Ids are `sess_*`, records live under sessions/, and verifyRunBundle
 *     refuses them by name. The record's evidence block is all false.
 *   - Transport is a Unix socket in a fresh 0700 directory, so only this user
 *     can connect. The engine must present a one-time token in its hello, and
 *     the harness accepts exactly one connection, then stops listening.
 *   - Pixels never cross the socket. The harness names the snapshot file
 *     (`snapshots/NNNN.png`); the engine writes it into the session directory;
 *     the harness checks it is a regular file inside that directory and
 *     decodes it before reporting anything.
 *   - Engine answers to state queries are untrusted data: parsed, size-bound,
 *     and returned as data, never interpreted.
 *   - `promote` turns what the session found into a scenario plan, so the
 *     hypothesis is then proved -- or not -- by a sealed run.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { decodeImage } from '../inspection/image.js';
import { canonicalJson } from '../packages/format.js';
import { invalidInput, invalidState, notFound } from '../util/errors.js';
import { planScenarioRun, type LoadedAdapter, type ScenarioRunPlan } from './adapter.js';
import { safeChildEnvironment } from './run-bundle.js';
import { boundedFileSHA256 } from '../util/file-identity.js';

export const GAME_DEV_SESSION_SCHEMA = 'game_dev.session.v1' as const;

const HELLO_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 512 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const DEFAULT_MAX_SECONDS = 600;
const MAX_EVENTS = 1_000;

export interface SessionEvent {
  at: string;
  op: string;
  ok: boolean;
  frameIndex?: number;
  snapshot?: { path: string; sha256: string; width: number; height: number };
  error?: string;
}

export interface SessionRecord {
  schema: typeof GAME_DEV_SESSION_SCHEMA;
  sessionId: string;
  sessionPath: string;
  adapterId: string;
  scenarioId: string;
  projectRoot: string;
  parameters: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  events: SessionEvent[];
  evidence: {
    sealed: false;
    verifiable: false;
    countsAsEvidence: false;
    hardwareGpuExecutionProvenByHarnessAlone: false;
    humanVisualReviewPerformed: false;
  };
  evidenceCeiling: string;
}

const EVIDENCE_CEILING =
  'A live session is an interactive conversation with a running process. Nothing in it is sealed or ' +
  'hashed into a closed roster, the engine can answer queries however it likes, and the record can be ' +
  'changed after the fact. Use it to form a hypothesis, then promote it to a scenario run and prove it.';

/** Short socket paths: sun_path is 104 bytes on macOS and $TMPDIR is long. */
async function socketDirectory(): Promise<string> {
  for (const base of [os.tmpdir(), '/tmp']) {
    const candidate = await fs.mkdtemp(path.join(base, 'gdp-')).catch(() => undefined);
    if (!candidate) continue;
    if (Buffer.byteLength(path.join(candidate, 's')) <= 100) {
      await fs.chmod(candidate, 0o700);
      return candidate;
    }
    await fs.rm(candidate, { recursive: true, force: true });
  }
  throw invalidState('no temporary directory yields a socket path short enough for this platform');
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class LiveSession {
  readonly record: SessionRecord;
  private readonly child: ChildProcess;
  private readonly socketDir: string;
  private readonly server: net.Server;
  private connection?: net.Socket;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private nextSnapshot = 1;
  private buffered = '';
  private closed = false;
  private ending?: Promise<SessionRecord>;
  private readonly lifetime: NodeJS.Timeout;
  private readonly logs: { stdout: Buffer[]; stderr: Buffer[]; bytes: number } = { stdout: [], stderr: [], bytes: 0 };

  private constructor(options: {
    record: SessionRecord; child: ChildProcess; socketDir: string; server: net.Server; maxSeconds: number;
  }) {
    this.record = options.record;
    this.child = options.child;
    this.socketDir = options.socketDir;
    this.server = options.server;
    this.lifetime = setTimeout(() => { void this.end('session reached its maximum lifetime'); }, options.maxSeconds * 1000);
    this.lifetime.unref();
    for (const stream of ['stdout', 'stderr'] as const) {
      this.child[stream]?.on('data', (chunk: Buffer) => {
        if (this.logs.bytes >= MAX_LOG_BYTES) return;
        const slice = chunk.subarray(0, MAX_LOG_BYTES - this.logs.bytes);
        this.logs[stream].push(slice);
        this.logs.bytes += slice.length;
      });
    }
    this.child.once('exit', () => { void this.end('engine process exited'); });
  }

  static async start(options: {
    adapter: LoadedAdapter;
    plan: ScenarioRunPlan;
    sessionsRoot: string;
    maxSeconds?: number;
  }): Promise<LiveSession> {
    const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS;
    if (!Number.isInteger(maxSeconds) || maxSeconds < 5 || maxSeconds > 3_600) throw invalidInput('maxSeconds must be from 5 through 3600');
    if (options.plan.adapterManifestSha256 !== options.adapter.manifestSha256) {
      throw invalidState('scenario plan no longer matches the loaded adapter manifest');
    }
    // The same pre-launch identity check a sealed run makes for Node scenarios.
    if (options.plan.runtime === 'node') {
      if (options.plan.runtimeExecutable !== await fs.realpath(process.execPath)
        || await boundedFileSHA256(options.plan.runtimeExecutable) !== options.plan.runtimeSHA256
        || await fs.realpath(options.plan.executable) !== options.plan.executable
        || await boundedFileSHA256(options.plan.executable, 16 * 1024 * 1024) !== options.plan.executableSHA256) {
        throw invalidState('Node scenario changed after planning; no process was started');
      }
    }

    const sessionId = `sess_${Date.now()}_${randomBytes(12).toString('hex')}`;
    const sessionPath = path.join(path.resolve(options.sessionsRoot), sessionId);
    await fs.mkdir(path.join(sessionPath, 'snapshots'), { recursive: true, mode: 0o700 });
    const socketDir = await socketDirectory();
    const socketPath = path.join(socketDir, 's');
    const token = randomBytes(24).toString('hex');

    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
    await fs.chmod(socketPath, 0o600);

    // The run-scenario environment, minus anything that would make the
    // engine believe it is in a sealed capture: a session writes no run.
    const environment = safeChildEnvironment(options.plan);
    for (const name of ['GAME_DEV_RUN_ID', 'GAME_DEV_RUN_DIR', 'GAME_DEV_CAPTURE_MANIFEST']) delete environment[name];
    environment.GAME_DEV_SESSION_SOCKET = socketPath;
    environment.GAME_DEV_SESSION_TOKEN = token;
    environment.GAME_DEV_SESSION_DIR = sessionPath;

    const plan = options.plan;
    const child = spawn(plan.runtime === 'node' ? plan.runtimeExecutable! : plan.executable,
      plan.runtime === 'node' ? [plan.executable, ...plan.arguments] : plan.arguments, {
        cwd: plan.workingDirectory,
        env: environment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    const record: SessionRecord = {
      schema: GAME_DEV_SESSION_SCHEMA,
      sessionId,
      sessionPath,
      adapterId: plan.adapterId,
      scenarioId: plan.scenarioId,
      projectRoot: plan.projectRoot,
      parameters: plan.parameters,
      startedAt: new Date().toISOString(),
      events: [],
      evidence: {
        sealed: false,
        verifiable: false,
        countsAsEvidence: false,
        hardwareGpuExecutionProvenByHarnessAlone: false,
        humanVisualReviewPerformed: false,
      },
      evidenceCeiling: EVIDENCE_CEILING,
    };
    const session = new LiveSession({ record, child, socketDir, server, maxSeconds });

    try {
      await session.acceptHello(token);
    } catch (error) {
      await session.end(error instanceof Error ? error.message : String(error));
      throw error;
    }
    session.log({ op: 'hello', ok: true });
    await session.persist();
    return session;
  }

  private acceptHello(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(invalidState('the engine did not connect with the session token in time; does it call gdprobe_session_open?')), HELLO_TIMEOUT_MS);
      this.child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(invalidState('the engine exited before joining the session', { code, signal }));
      });
      this.server.on('connection', (socket) => {
        if (this.connection) { socket.destroy(); return; }
        let first = '';
        const onData = (chunk: Buffer) => {
          first += chunk.toString('utf8');
          if (first.length > 4096) { socket.destroy(); return; }
          const newline = first.indexOf('\n');
          if (newline < 0) return;
          socket.off('data', onData);
          let hello: { op?: unknown; token?: unknown; protocol?: unknown } = {};
          try { hello = JSON.parse(first.slice(0, newline)); } catch { /* refused below */ }
          if (hello.op !== 'hello' || hello.token !== token || hello.protocol !== GAME_DEV_SESSION_SCHEMA) {
            // Not our engine, or not this session: drop it and keep waiting.
            socket.destroy();
            return;
          }
          clearTimeout(timer);
          this.connection = socket;
          // One connection, ever: stop listening so nothing else can join.
          this.server.close();
          this.buffered = first.slice(newline + 1);
          socket.on('data', (data: Buffer) => this.onData(data));
          socket.on('close', () => { void this.end('engine closed the connection'); });
          resolve();
        };
        socket.on('data', onData);
        socket.on('error', () => socket.destroy());
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffered += chunk.toString('utf8');
    if (this.buffered.length > MAX_LINE_BYTES) {
      void this.end('engine sent an oversized message');
      return;
    }
    let newline;
    while ((newline = this.buffered.indexOf('\n')) >= 0) {
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      let message: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
      try { message = JSON.parse(line); } catch { continue; }
      if (typeof message.id !== 'number') continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok === true) {
        pending.resolve(message.result !== null && typeof message.result === 'object' ? message.result as Record<string, unknown> : { value: message.result });
      } else {
        pending.reject(invalidState(`engine refused: ${typeof message.error === 'string' ? message.error.slice(0, 500) : 'no reason given'}`));
      }
    }
  }

  private request(op: string, fields: Record<string, string | number> = {}): Promise<Record<string, unknown>> {
    if (this.closed || !this.connection) return Promise.reject(invalidState('the session has ended', { sessionId: this.record.sessionId }));
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, op, ...fields })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(invalidState(`the engine did not answer ${op} in time; is it calling gdprobe_session_poll every frame?`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.connection!.write(line);
    });
  }

  private log(event: Omit<SessionEvent, 'at'>): void {
    if (this.record.events.length < MAX_EVENTS) this.record.events.push({ at: new Date().toISOString(), ...event });
  }

  private async persist(): Promise<void> {
    await fs.writeFile(path.join(this.record.sessionPath, 'session.json'), canonicalJson(this.record), { mode: 0o600 });
  }

  private async guarded<T extends Record<string, unknown>>(op: string, work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      this.log({ op, ok: true, ...(typeof result.frameIndex === 'number' ? { frameIndex: result.frameIndex } : {}) });
      return result;
    } catch (error) {
      this.log({ op, ok: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await this.persist();
    }
  }

  /** Ask for the current frame; the engine writes the PNG, the harness checks and decodes it. */
  async snapshot(): Promise<{ path: string; frameIndex: number; width: number; height: number; sha256: string }> {
    const relative = `snapshots/${String(this.nextSnapshot++).padStart(4, '0')}.png`;
    const reply = await this.request('snapshot', { path: relative });
    try {
      if (reply.path !== relative) throw invalidState('the engine reported a different snapshot path than it was asked for');
      const absolute = path.join(this.record.sessionPath, relative);
      const stats = await fs.lstat(absolute).catch(() => undefined);
      if (!stats || !stats.isFile() || stats.isSymbolicLink()) throw invalidState('the snapshot is not a regular file in the session directory');
      const real = await fs.realpath(absolute);
      const root = await fs.realpath(this.record.sessionPath);
      if (path.relative(root, real).startsWith('..')) throw invalidState('the snapshot resolved outside the session directory');
      const bytes = await fs.readFile(real);
      const image = decodeImage(bytes);
      const snapshot = {
        path: real,
        frameIndex: typeof reply.frameIndex === 'number' ? reply.frameIndex : -1,
        width: image.width,
        height: image.height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      this.log({
        op: 'snapshot', ok: true, frameIndex: snapshot.frameIndex,
        snapshot: { path: relative, sha256: snapshot.sha256, width: snapshot.width, height: snapshot.height },
      });
      return snapshot;
    } catch (error) {
      this.log({ op: 'snapshot', ok: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await this.persist();
    }
  }

  /** The engine's answer, as untrusted data. */
  query(text: string): Promise<Record<string, unknown>> {
    if (text.length === 0 || text.length > 1_000) return Promise.reject(invalidInput('a query must be 1 to 1000 characters'));
    return this.guarded('state_query', () => this.request('state_query', { query: text }));
  }

  pause(): Promise<Record<string, unknown>> { return this.guarded('pause', () => this.request('pause')); }
  resume(): Promise<Record<string, unknown>> { return this.guarded('resume', () => this.request('resume')); }
  step(frames = 1): Promise<Record<string, unknown>> {
    if (!Number.isInteger(frames) || frames < 1 || frames > 10_000) return Promise.reject(invalidInput('frames must be from 1 through 10000'));
    return this.guarded('step', () => this.request('step', { frames }));
  }

  get ended(): boolean { return this.closed; }

  /** Idempotent: the engine exiting and its socket closing both call this. */
  end(reason = 'ended by request'): Promise<SessionRecord> {
    this.ending ??= this.finish(reason);
    return this.ending;
  }

  /** For process exit, where nothing asynchronous will run. */
  killNow(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }

  private async finish(reason: string): Promise<SessionRecord> {
    if (this.connection && !this.connection.destroyed) {
      await this.request('bye').catch(() => undefined);
    }
    this.closed = true;
    clearTimeout(this.lifetime);
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(invalidState('the session ended')); }
    this.pending.clear();
    this.connection?.destroy();
    this.server.close();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 3_000);
        this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    await fs.rm(this.socketDir, { recursive: true, force: true });
    this.record.endedAt = new Date().toISOString();
    this.record.endReason = reason;
    await fs.writeFile(path.join(this.record.sessionPath, 'stdout.log'), Buffer.concat(this.logs.stdout), { mode: 0o600 });
    await fs.writeFile(path.join(this.record.sessionPath, 'stderr.log'), Buffer.concat(this.logs.stderr), { mode: 0o600 });
    await this.persist();
    return this.record;
  }
}

/** Every session started by this process, so tools can address them by id and nothing outlives the process. */
export class SessionRegistry {
  private readonly sessions = new Map<string, LiveSession>();

  constructor() {
    process.once('exit', () => {
      // Synchronous: the process is going away and no promise will settle.
      for (const session of this.sessions.values()) session.killNow();
    });
  }

  add(session: LiveSession): void {
    this.sessions.set(session.record.sessionId, session);
  }

  get(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw notFound('live session', sessionId);
    return session;
  }

  async end(sessionId: string): Promise<SessionRecord> {
    const record = await this.get(sessionId).end();
    this.sessions.delete(sessionId);
    return record;
  }
}

/**
 * Turn a session into a scenario plan: the same scenario and parameters, so a
 * sealed run can reproduce what the session showed. Plans; never runs.
 */
export async function promoteSession(options: {
  record: SessionRecord;
  adapter: LoadedAdapter;
  runsRoot: string;
}): Promise<{ plan: ScenarioRunPlan; lastSnapshot?: SessionEvent['snapshot'] & { frameIndex?: number }; note: string }> {
  if (options.adapter.manifest.id !== options.record.adapterId) throw invalidInput('the adapter does not match the session');
  const plan = await planScenarioRun({
    adapter: options.adapter,
    scenarioId: options.record.scenarioId,
    runsRoot: options.runsRoot,
    parameters: options.record.parameters,
  });
  const last = [...options.record.events].reverse().find((event) => event.snapshot);
  return {
    plan,
    ...(last?.snapshot ? { lastSnapshot: { ...last.snapshot, ...(last.frameIndex !== undefined ? { frameIndex: last.frameIndex } : {}) } } : {}),
    note:
      'This plan reproduces the session\'s scenario and parameters as a sealed run. Run it with run_scenario, then ' +
      'compare its capture against the session snapshot or a baseline; the session itself proves nothing.',
  };
}
