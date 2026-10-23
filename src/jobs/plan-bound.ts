/** Opt-in durable plan-bound storage primitives. There is no worker launcher or
 * client-disconnect lifecycle here. Ownership is workflow control, not a sandbox:
 * same-user malicious concurrent ancestor replacement needs OS isolation. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { atomicJson, withTransaction, recoverTransactionLock } from '../storage/transaction.js';
import { redact } from '../util/logging.js';
import { invalidInput, invalidState } from '../util/errors.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ownerSchema = z.object({ token: z.string().uuid(), pid: z.number().int().positive(), host: z.string(), heartbeatAt: z.string().datetime() }).strict();
export const planBoundJobSchema = z.object({
  schema: z.literal('game_dev.job.v2'), id: z.string().regex(/^job_[0-9a-f-]{36}$/),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/), binding: digest,
  requestHash: digest, planHash: digest, idempotencyHash: digest,
  status: z.enum(['queued', 'running', 'cancellation_requested', 'stopped', 'completed', 'failed', 'remote_outcome_uncertain']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  owner: ownerSchema.optional(), checkpoints: z.array(z.object({ sequence: z.number().int().nonnegative(), at: z.string().datetime(), value: z.record(z.unknown()) }).strict()).max(64),
  submissionStarted: z.boolean(), revision: z.number().int().nonnegative(),
}).strict();
export type PlanBoundJob = z.infer<typeof planBoundJobSchema>;
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  throw invalidInput('Job binding requires JSON values');
}
const hash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const terminal = (job: PlanBoundJob): boolean => ['stopped', 'completed', 'failed', 'remote_outcome_uncertain'].includes(job.status);
interface JobEvents {
  append(id: string, event: Record<string, unknown>): void;
  read(id: string): Promise<Record<string, unknown>[]>;
  legacy(id: string): Promise<unknown>;
}
async function safeAncestors(target: string): Promise<void> {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) {
      const systemAlias = process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && await fs.realpath(current) === `/private${current}`;
      if (!systemAlias) throw invalidState('Symlink in durable job storage path');
    } }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
export class PlanBoundJobStore {
  private constructor(private readonly root: string, private readonly events: JobEvents) {}
  static async open(root: string, events: JobEvents): Promise<PlanBoundJobStore> {
    await safeAncestors(root);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await safeAncestors(root);
    return new PlanBoundJobStore(await fs.realpath(root), events);
  }
  private target(id: string): string {
    if (!/^job_[0-9a-f-]{36}$/.test(id)) throw invalidInput('Malformed job identity');
    return path.join(this.root, id, 'job-v2.json');
  }
  private async read(target: string): Promise<unknown> {
    await safeAncestors(path.dirname(target));
    const before = await fs.lstat(target);
    if (!before.isFile() || before.nlink !== 1 || before.size > 2 * 1024 * 1024) throw invalidState('Unsafe durable job record');
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (before.ino !== opened.ino || before.dev !== opened.dev) throw invalidState('Durable job record changed while opening');
      return JSON.parse(await handle.readFile('utf8')) as unknown;
    } finally { await handle.close(); }
  }
  /** Readers share the writer transaction so state and its fsynced event are
   * observed together. A dead writer's lock must be explicitly recovered first.
   * Lock order is idempotency key -> job; no job transaction acquires a key lock.
   */
  async get(id: string): Promise<PlanBoundJob> {
    await safeAncestors(this.target(id));
    return withTransaction(this.target(id), () => this.getUnlocked(id));
  }
  private async getUnlocked(id: string): Promise<PlanBoundJob> {
    const parsed = planBoundJobSchema.safeParse(await this.read(this.target(id)));
    if (!parsed.success || parsed.data.id !== id) throw invalidState('Corrupt v2 job');
    const job = parsed.data;
    if (job.binding !== hash({ operation: job.operation, requestHash: job.requestHash, planHash: job.planHash })) throw invalidState('Corrupt job binding');
    if (job.checkpoints.some((item, index) => item.sequence !== index)) throw invalidState('Corrupt checkpoint sequence');
    if (['running', 'cancellation_requested'].includes(job.status) && !job.owner) throw invalidState('Running job missing owner');
    await this.read(path.join(this.root, id, 'job-v2.json')); // recheck path before shared event reader
    const eventPath = path.join(this.root, id, 'events.jsonl');
    await safeAncestors(eventPath);
    const eventStat = await fs.lstat(eventPath);
    if (!eventStat.isFile() || eventStat.nlink !== 1 || eventStat.size > 32 * 1024 * 1024) throw invalidState('Unsafe durable event stream');
    const events = await this.events.read(id);
    if (events.length !== job.revision + 1 || events.some((event, index) => event.sequence !== index || event.schema !== 'game_dev.job_event.v2' || event.jobId !== id)) throw invalidState('Interrupted or corrupt durable job event transaction; preserve evidence for explicit reconciliation');
    const latest = events.at(-1)!;
    if (latest.stateHash !== hash(job)) throw invalidState('Job state and event evidence disagree');
    return job;
  }
  async list(limit = 100): Promise<{ jobs: PlanBoundJob[]; skipped: { id: string; reason: string }[] }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw invalidInput('Invalid job limit');
    await safeAncestors(this.root);
    const jobs: PlanBoundJob[] = [], skipped: { id: string; reason: string }[] = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!/^job_[0-9a-f-]{36}$/.test(entry.name)) continue;
      if (!entry.isDirectory()) { skipped.push({ id: entry.name, reason: 'Unsafe job directory' }); continue; }
      try {
        await fs.lstat(this.target(entry.name));
        jobs.push(await this.get(entry.name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped.push({ id: entry.name, reason: String(error) });
      }
    }
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { jobs: jobs.slice(0, limit), skipped };
  }
  private emit(job: PlanBoundJob): void {
    this.events.append(job.id, { schema: 'game_dev.job_event.v2', jobId: job.id, sequence: job.revision, at: job.updatedAt, status: job.status, stateHash: hash(job) });
  }
  /** A lost mapping is ambiguous evidence, not permission for a second paid job.
   * The bounded scan runs while holding this key's transaction lock. Corrupt or
   * interrupted identities block new submission; callers must reconcile bytes.
   */
  private async requireUnusedKey(idempotencyHash: string): Promise<void> {
    const entries = await fs.opendir(this.root);
    let count = 0;
    for await (const entry of entries) {
      if (++count > 10000) throw invalidState('Job storage exceeds the 10000-entry submission scan budget; reconcile/archive before creating a new identity');
      if (!/^job_[0-9a-f-]{36}$/.test(entry.name)) continue;
      if (!entry.isDirectory()) throw invalidState('Unsafe job identity prevents idempotency reconciliation');
      try {
        await fs.lstat(this.target(entry.name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try { await this.events.legacy(entry.name); }
        catch { throw invalidState('Incomplete or corrupt job identity prevents idempotency reconciliation'); }
        continue;
      }
      let job: PlanBoundJob;
      try { job = await this.get(entry.name); }
      catch { throw invalidState('Unreadable or corrupt job identity prevents idempotency reconciliation'); }
      if (job.idempotencyHash === idempotencyHash) throw invalidState('Idempotency mapping is missing for an existing identity; reconcile original evidence without resubmission');
    }
  }
  async submit(input: { operation: string; request: Record<string, unknown>; plan: Record<string, unknown>; idempotencyKey: string }): Promise<PlanBoundJob> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 1024) throw invalidInput('Invalid idempotency key');
    const idempotencyHash = hash(input.idempotencyKey), requestHash = hash(input.request), planHash = hash(input.plan);
    const binding = hash({ operation: input.operation, requestHash, planHash });
    const mapping = path.join(this.root, `key-${idempotencyHash}.json`);
    await safeAncestors(mapping);
    return withTransaction(mapping, async () => {
      try {
        const value = z.object({ id: z.string(), binding: digest }).strict().parse(await this.read(mapping));
        let job: PlanBoundJob;
        try { job = await this.get(value.id); } catch { throw invalidState('Idempotency mapping references missing or corrupt job'); }
        if (value.binding !== binding || job.binding !== binding || job.idempotencyHash !== idempotencyHash) throw invalidState('Idempotency binding mismatch');
        return job;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await this.requireUnusedKey(idempotencyHash);
      const at = new Date().toISOString();
      const job = planBoundJobSchema.parse({ schema: 'game_dev.job.v2', id: `job_${randomUUID()}`, operation: input.operation, binding, requestHash, planHash, idempotencyHash, status: 'queued', createdAt: at, updatedAt: at, checkpoints: [], submissionStarted: false, revision: 0 });
      // Reserve key first: a crash leaves an unusable mapping, never a second submission.
      await fs.mkdir(path.dirname(this.target(job.id)), { mode: 0o700 });
      await atomicJson(mapping, { id: job.id, binding });
      await fs.writeFile(path.join(this.root, job.id, 'events.jsonl'), '', { flag: 'wx', mode: 0o600 });
      await atomicJson(this.target(job.id), job);
      this.emit(job);
      return job;
    });
  }
  private async update(id: string, action: (job: PlanBoundJob) => void): Promise<PlanBoundJob> {
    await safeAncestors(this.target(id));
    return withTransaction(this.target(id), async () => {
      const job = await this.getUnlocked(id); action(job); job.revision++; job.updatedAt = new Date().toISOString();
      planBoundJobSchema.parse(job); await safeAncestors(this.target(id)); await atomicJson(this.target(id), job); this.emit(job); return job;
    });
  }
  private owns(job: PlanBoundJob, token: string): void {
    if (!job.owner || job.owner.token !== token || job.owner.pid !== process.pid || job.owner.host !== os.hostname() || terminal(job)) throw invalidState('Worker ownership mismatch');
  }
  async claim(id: string, binding: string): Promise<PlanBoundJob> {
    return this.update(id, job => {
      if (job.status !== 'queued' || job.owner || job.binding !== binding) throw invalidState('Job cannot be claimed');
      job.owner = { token: randomUUID(), pid: process.pid, host: os.hostname(), heartbeatAt: new Date().toISOString() }; job.status = 'running';
    });
  }
  async heartbeat(id: string, token: string): Promise<PlanBoundJob> { return this.update(id, job => { this.owns(job, token); job.owner!.heartbeatAt = new Date().toISOString(); }); }
  async markSubmissionStarted(id: string, token: string): Promise<PlanBoundJob> { return this.update(id, job => { this.owns(job, token); if (job.submissionStarted || job.status !== 'running') throw invalidState('Submission cannot repeat'); job.submissionStarted = true; }); }
  async checkpoint(id: string, token: string, value: Record<string, unknown>): Promise<PlanBoundJob> {
    if (Buffer.byteLength(canonical(value)) > 16384) throw invalidInput('Checkpoint exceeds 16 KiB');
    return this.update(id, job => { this.owns(job, token); if (job.checkpoints.length >= 64) throw invalidState('Checkpoint budget exhausted'); job.checkpoints.push({ sequence: job.checkpoints.length, at: new Date().toISOString(), value: redact(value) as Record<string, unknown> }); });
  }
  async requestCancellation(id: string): Promise<PlanBoundJob> { return this.update(id, job => { if (!terminal(job)) job.status = job.owner ? 'cancellation_requested' : 'stopped'; }); }
  /** `failed` is only for a known terminal failure. After reservation, transport
   * loss/timeouts/unreconciled provider errors MUST use remote_outcome_uncertain.
   * This storage primitive cannot infer a provider outcome from an exception.
   */
  async finish(id: string, token: string, outcome: 'completed' | 'failed' | 'stopped' | 'remote_outcome_uncertain'): Promise<PlanBoundJob> { return this.update(id, job => { this.owns(job, token); if (outcome === 'stopped' && job.submissionStarted) job.status = 'remote_outcome_uncertain'; else job.status = outcome; }); }
  async recoverStorageLock(id: string, confirm: boolean): Promise<void> {
    await safeAncestors(this.target(id));
    await recoverTransactionLock(this.target(id), confirm);
  }
  async recoverIdempotencyLock(key: string, confirm: boolean): Promise<void> {
    const target = path.join(this.root, `key-${hash(key)}.json`);
    await safeAncestors(target);
    await recoverTransactionLock(target, confirm);
  }
  async recoverDeadOwner(id: string, confirm: boolean): Promise<PlanBoundJob> {
    if (!confirm) throw invalidState('Recovery requires explicit confirmation');
    return this.update(id, job => {
      if (terminal(job) || !job.owner || job.owner.host !== os.hostname()) throw invalidState('Cannot establish dead owner');
      try { process.kill(job.owner.pid, 0); throw invalidState('Worker is alive'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      job.status = job.submissionStarted ? 'remote_outcome_uncertain' : 'stopped';
    });
  }
}
