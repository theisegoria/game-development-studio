/**
 * Live sessions, end to end, against a C engine built on the real SDK.
 *
 * The engine draws a frame whose brightness is its frame counter, answers
 * state queries from a tiny "scene graph", and obeys pause and step. The
 * tests check the behaviour that matters to an AI debugging a running game
 * -- pause holds the frame, step advances exactly N, the snapshot is the
 * frame it claims -- and the boundaries that keep a session from ever
 * passing for evidence or being joined by anything else.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA } from '../src/harness/contracts.js';
import { verifyRunBundle } from '../src/harness/run-bundle.js';
import { LiveSession, promoteSession } from '../src/harness/session.js';
import { decodeImage } from '../src/inspection/image.js';
import { canonicalJson } from '../src/packages/format.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdkDir = path.join(repoRoot, 'probe', 'c');
const onPosix = process.platform !== 'win32';
function compilerAvailable(): boolean {
  try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const runnable = onPosix && compilerAvailable();

const ENGINE = String.raw`
#define _POSIX_C_SOURCE 200809L
#include "gdprobe.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#define W 8
#define H 4
static unsigned char pixels[W * H * 4];
static int frame = 0;
static gdprobe_status snapshot(void *user, const unsigned char **out, uint32_t *w, uint32_t *h, size_t *stride) {
  (void) user; *out = pixels; *w = W; *h = H; *stride = W * 4; return GDPROBE_OK;
}
static gdprobe_status query(void *user, const char *q, char *out, size_t capacity) {
  (void) user;
  if (strcmp(q, "object 7") == 0) {
    snprintf(out, capacity, "{\"id\":7,\"visible\":false,\"reason\":\"culled: bounds behind near plane\",\"frame\":%d}", frame);
  } else {
    snprintf(out, capacity, "{\"unknown\":\"%s\"}", "query");
  }
  return GDPROBE_OK;
}
int main(void) {
  gdprobe_status status;
  gdprobe_session *session = gdprobe_session_open(&status);
  if (!session) { puts("no session"); return status == GDPROBE_NOT_ATTACHED ? 0 : 1; }
  gdprobe_session_handlers handlers = { snapshot, query };
  struct timespec nap = { 0, 2000000 };
  while (!gdprobe_session_closed(session)) {
    gdprobe_session_poll(session, &handlers, NULL, frame);
    if (gdprobe_session_should_advance(session)) {
      frame += 1;
      for (int i = 0; i < W * H; i += 1) {
        pixels[i * 4] = (unsigned char) (frame % 256); pixels[i * 4 + 1] = 0; pixels[i * 4 + 2] = 0; pixels[i * 4 + 3] = 255;
      }
    }
    nanosleep(&nap, NULL);
  }
  gdprobe_session_close(session);
  return 0;
}
`;

let root: string;
let projectRoot: string;
const open: LiveSession[] = [];

beforeAll(async () => {
  if (!runnable) return;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-session-'));
  projectRoot = path.join(root, 'engine');
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  await fs.writeFile(path.join(root, 'engine.c'), ENGINE);
  execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', `-I${sdkDir}`,
    path.join(sdkDir, 'gdprobe.c'), path.join(sdkDir, 'gdprobe_session.c'), path.join(root, 'engine.c'),
    '-o', path.join(projectRoot, 'engine')], { stdio: 'pipe' });
  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'session-fixture',
    name: 'Session fixture',
    version: '1.0.0',
    scenarios: [{
      id: 'play', title: 'Run interactively', command: { executable: 'engine', arguments: [], workingDirectory: '.' },
      timeoutSeconds: 60, capabilities: ['cpu'], parameters: {},
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((session) => session.end()));
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function start(): Promise<LiveSession> {
  const adapter = await loadAdapter(projectRoot);
  const plan = await planScenarioRun({ adapter, scenarioId: 'play', runsRoot: path.join(root, 'runs') });
  const session = await LiveSession.start({ adapter, plan, sessionsRoot: path.join(root, 'sessions'), maxSeconds: 60 });
  open.push(session);
  return session;
}

describe.skipIf(!runnable)('a live session with a running engine', () => {
  it('holds the frame while paused and advances exactly N on step', async () => {
    const session = await start();
    const paused = await session.pause();
    const held = await session.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stillHeld = await session.snapshot();
    expect(stillHeld.frameIndex).toBe(held.frameIndex);
    expect(stillHeld.sha256).toBe(held.sha256);

    const stepped = await session.step(3);
    expect(stepped.frameIndex).toBe((paused.frameIndex as number) + 3);
    const after = await session.snapshot();
    expect(after.frameIndex).toBe(stepped.frameIndex);
    // The snapshot is the frame it claims: brightness is the frame counter.
    const image = decodeImage(await fs.readFile(after.path));
    expect(image.data[0]).toBe((after.frameIndex as number) % 256);
  }, 60_000);

  it('answers state queries from the engine as data', async () => {
    const session = await start();
    const answer = await session.query('object 7');
    expect(answer).toMatchObject({ id: 7, visible: false, reason: 'culled: bounds behind near plane' });
  }, 60_000);

  it('is never evidence: sess_ ids, an all-false record, and verification refuses it', async () => {
    const session = await start();
    await session.snapshot();
    const record = await session.end();

    expect(record.sessionId).toMatch(/^sess_/);
    expect(Object.values(record.evidence).every((value) => value === false)).toBe(true);
    expect(record.events.map((event) => event.op)).toEqual(['hello', 'snapshot']);
    expect(record.events[1]?.snapshot?.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyRunBundle(record.sessionPath)).rejects.toThrow(/never evidence/);
    const onDisk = JSON.parse(await fs.readFile(path.join(record.sessionPath, 'session.json'), 'utf8'));
    expect(onDisk.endedAt).toBeDefined();
  }, 60_000);

  it('accepts one connection with the token and stops listening', async () => {
    const session = await start();
    const socketPath = (session as unknown as { socketDir: string }).socketDir;
    const intruder = net.connect(path.join(socketPath, 's'));
    const refused = await new Promise<boolean>((resolve) => {
      intruder.once('error', () => resolve(true));
      intruder.once('connect', () => { intruder.destroy(); resolve(false); });
    });
    expect(refused).toBe(true);
    // The session still works after the attempt.
    expect((await session.query('object 7')).id).toBe(7);
  }, 60_000);

  it('promotes to a scenario plan, never a run', async () => {
    const session = await start();
    await session.snapshot();
    const record = await session.end();
    const promoted = await promoteSession({ record, adapter: await loadAdapter(projectRoot), runsRoot: path.join(root, 'runs') });
    expect(promoted.plan.scenarioId).toBe('play');
    expect(promoted.lastSnapshot?.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(fs.access(promoted.plan.runPath)).rejects.toThrow();
  }, 60_000);

  it('runs a scripted session from the CLI and promotes it', async () => {
    const script = path.join(root, 'script.json');
    await fs.writeFile(script, JSON.stringify([
      { op: 'pause' }, { op: 'snapshot' }, { op: 'step', frames: 2 }, { op: 'query', query: 'object 7' },
    ]));
    const cli = path.join(repoRoot, 'dist', 'cli.js');
    const environment = { ...process.env, ASSET_OUTPUT_DIR: path.join(root, 'assets') };
    const dry = JSON.parse(execFileSync(process.execPath, [cli, 'session', 'run', 'play', '--project', projectRoot, '--script', script, '--json'], { env: environment, encoding: 'utf8' }));
    expect(dry.data.dryRun).toBe(true);

    const result = JSON.parse(execFileSync(process.execPath, [cli, 'session', 'run', 'play', '--project', projectRoot, '--script', script, '--confirm', '--json'], { env: environment, encoding: 'utf8' }));
    expect(result.ok).toBe(true);
    expect(result.data.results.map((step: { op: string }) => step.op)).toEqual(['pause', 'snapshot', 'step', 'query']);
    expect(result.data.results[2].result.frameIndex).toBe(result.data.results[0].result.frameIndex + 2);
    expect(result.data.results[3].result.visible).toBe(false);
    expect(result.data.record.endReason).toBe('script finished');
    expect(result.data.promoted.plan.scenarioId).toBe('play');
  }, 90_000);

  it('cleans up the engine and the socket directory when it ends', async () => {
    const session = await start();
    const socketDir = (session as unknown as { socketDir: string }).socketDir;
    await session.end();
    await expect(fs.access(socketDir)).rejects.toThrow();
    await expect(session.snapshot()).rejects.toThrow(/ended/);
  }, 60_000);
});
