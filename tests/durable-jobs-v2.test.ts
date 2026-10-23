import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableJobStore } from '../src/jobs/durable.js';
describe('plan-bound durable jobs', () => {
  it('binds idempotency and exclusively claims, bounds checkpoints and preserves uncertain cancellation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-'));
    try {
      const legacy = await DurableJobStore.open(root), store = await legacy.planBound();
      const input = { operation: 'provider.generate', request: { prompt: 'crate' }, plan: { maxCost: 2 }, idempotencyKey: 'request-one' };
      const jobs = await Promise.all([store.submit(input), store.submit(input)]);
      expect(jobs[0].id).toBe(jobs[1].id);
      await expect(store.submit({ ...input, plan: { maxCost: 3 } })).rejects.toThrow();
      const claims = await Promise.allSettled([store.claim(jobs[0].id, jobs[0].binding), store.claim(jobs[0].id, jobs[0].binding)]);
      expect(claims.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const job = await store.get(jobs[0].id), token = job.owner!.token;
      await expect(store.heartbeat(job.id, 'wrong')).rejects.toThrow();
      await store.checkpoint(job.id, token, { stage: 'prepared' });
      await expect(store.checkpoint(job.id, token, { x: 'x'.repeat(20000) })).rejects.toThrow();
      await store.markSubmissionStarted(job.id, token);
      await expect(store.markSubmissionStarted(job.id, token)).rejects.toThrow();
      expect((await store.requestCancellation(job.id)).status).toBe('cancellation_requested');
      expect((await store.finish(job.id, token, 'stopped')).status).toBe('remote_outcome_uncertain');
      await expect(store.claim(job.id, job.binding)).rejects.toThrow();
      const old = await legacy.create('tool.inspect', {});
      expect((await legacy.get(old.id)).schema).toBe('game_dev.job.v1');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('fails closed for corrupt mappings and missing records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-'));
    try {
      const store = await (await DurableJobStore.open(root)).planBound();
      const input = { operation: 'tool.inspect', request: {}, plan: {}, idempotencyKey: 'one' };
      const job = await store.submit(input);
      await fs.unlink(path.join(root, job.id, 'job-v2.json'));
      await expect(store.submit(input)).rejects.toThrow();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

const exec = promisify(execFile);
const durableModule = new URL('../dist/jobs/durable.js', import.meta.url).href;
async function processJob(root: string, body: string): Promise<Record<string, unknown>> {
  const script = `import { DurableJobStore } from ${JSON.stringify(durableModule)};
    const store = await (await DurableJobStore.open(${JSON.stringify(root)})).planBound();
    try { ${body} } catch (error) { console.log(JSON.stringify({ error: String(error) })); }`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', script]);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
describe('independent durable workers', () => {
  it('serializes separate processes, preserves one paid reservation, and explicitly seals dead owners', async () => {
    // Child workers load the same built implementation as the shipped CLI.
    await fs.access(fileURLToPath(new URL('../dist/jobs/plan-bound.js', import.meta.url)));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-process-'));
    try {
      const input = { operation: 'provider.generate', request: { prompt: 'box' }, plan: { amount: 2 }, idempotencyKey: 'same' };
      const results = await Promise.all(Array.from({ length: 4 }, () => processJob(root, `console.log(JSON.stringify(await store.submit(${JSON.stringify(input)})));`)));
      expect(new Set(results.map(r => r.id)).size).toBe(1);
      const job = results[0]!;
      const claim = `const job = await store.claim(${JSON.stringify(job.id)}, ${JSON.stringify(job.binding)}); await store.markSubmissionStarted(job.id, job.owner.token); console.log(JSON.stringify(job));`;
      const claims = await Promise.all([processJob(root, claim), processJob(root, claim)]);
      expect(claims.filter(r => r.id)).toHaveLength(1);
      const legacy = await DurableJobStore.open(root), store = await legacy.planBound();
      await expect(store.recoverDeadOwner(String(job.id), false)).rejects.toThrow();
      const recovered = await store.recoverDeadOwner(String(job.id), true);
      expect(recovered.status).toBe('remote_outcome_uncertain');
      expect(recovered.submissionStarted).toBe(true);
      expect((await store.submit(input)).id).toBe(job.id);
      await expect(store.claim(recovered.id, recovered.binding)).rejects.toThrow();
      const events = await legacy.readEvents(recovered.id);
      expect(events.map(e => e.sequence)).toEqual([0, 1, 2, 3]);
      expect((await legacy.listPlanBound()).jobs).toHaveLength(1);
      expect(await legacy.list()).toEqual([]);
      expect(legacy.lastListingSkipped()).toEqual([]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('requires explicit dead storage-lock recovery and never reclaims interrupted event evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-crash-'));
    try {
      const legacy = await DurableJobStore.open(root), store = await legacy.planBound();
      const input = { operation: 'provider.generate', request: {}, plan: {}, idempotencyKey: 'one' };
      const job = await store.submit(input);
      const owner = await processJob(root, 'console.log(JSON.stringify({ pid: process.pid }));');
      const target = path.join(root, job.id, 'job-v2.json');
      await fs.writeFile(`${target}.lock`, JSON.stringify({ schema: 'game_dev.lock.v1', pid: owner.pid, host: os.hostname() }));
      await expect(store.recoverStorageLock(job.id, false)).rejects.toThrow();
      await store.recoverStorageLock(job.id, true);
      const claimed = await store.claim(job.id, job.binding);
      await store.markSubmissionStarted(job.id, claimed.owner!.token);
      await fs.writeFile(legacy.eventsPath(job.id), ''); // crash between atomic state update and fsynced event
      await expect(store.get(job.id)).rejects.toThrow(/Interrupted or corrupt/);
      await expect(store.submit(input)).rejects.toThrow();
      await expect(store.claim(job.id, job.binding)).rejects.toThrow();
      expect((await legacy.listPlanBound()).skipped).toHaveLength(1);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('never replaces a lost idempotency mapping after a paid reservation or ambiguous identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-lost-key-'));
    try {
      const legacy = await DurableJobStore.open(root), store = await legacy.planBound();
      const input = { operation: 'provider.generate', request: {}, plan: {}, idempotencyKey: 'paid-one' };
      const job = await store.submit(input), claimed = await store.claim(job.id, job.binding);
      await store.markSubmissionStarted(job.id, claimed.owner!.token);
      const mapping = (await fs.readdir(root)).find(name => name.startsWith('key-') && name.endsWith('.json'))!;
      await fs.unlink(path.join(root, mapping));
      await expect(store.submit(input)).rejects.toThrow(/mapping is missing/);
      expect((await store.list()).jobs.map(item => item.id)).toEqual([job.id]);
      await expect(fs.access(path.join(root, mapping))).rejects.toThrow(); // no automatic repair
      await fs.writeFile(path.join(root, job.id, 'job-v2.json'), '{corrupt');
      await expect(store.submit({ ...input, idempotencyKey: 'different' })).rejects.toThrow(/corrupt job identity/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('permits cancellation progress but forbids new reservations and preserves explicit known/unknown outcomes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-cancel-'));
    try {
      const store = await (await DurableJobStore.open(root)).planBound();
      const job = await store.submit({ operation: 'provider.generate', request: {}, plan: {}, idempotencyKey: 'cancel-before-send' });
      const claimed = await store.claim(job.id, job.binding), token = claimed.owner!.token;
      await store.requestCancellation(job.id);
      expect((await store.heartbeat(job.id, token)).status).toBe('cancellation_requested');
      await store.checkpoint(job.id, token, { phase: 'cleanup' });
      await expect(store.markSubmissionStarted(job.id, token)).rejects.toThrow();
      expect((await store.finish(job.id, token, 'stopped')).status).toBe('stopped');
      for (const outcome of ['failed', 'remote_outcome_uncertain'] as const) {
        const next = await store.submit({ operation: 'provider.generate', request: {}, plan: {}, idempotencyKey: outcome });
        const owner = await store.claim(next.id, next.binding);
        await store.markSubmissionStarted(next.id, owner.owner!.token);
        expect((await store.finish(next.id, owner.owner!.token, outcome)).status).toBe(outcome);
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('rejects live recovery, swapped paths, corrupt mappings, and excessive checkpoint counts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jobs-v2-path-'));
    try {
      const legacy = await DurableJobStore.open(root), store = await legacy.planBound();
      const input = { operation: 'tool.inspect', request: {}, plan: {}, idempotencyKey: 'one' };
      const job = await store.submit(input), claimed = await store.claim(job.id, job.binding);
      await expect(store.recoverDeadOwner(job.id, true)).rejects.toThrow(/alive/);
      for (let i = 0; i < 64; i++) await store.checkpoint(job.id, claimed.owner!.token, { stage: i });
      await expect(store.checkpoint(job.id, claimed.owner!.token, {})).rejects.toThrow(/budget/);
      const dir = path.join(root, job.id);
      await fs.rename(dir, `${dir}-original`);
      await fs.symlink(`${dir}-original`, dir);
      await expect(store.get(job.id)).rejects.toThrow(/Symlink/);
      await expect(store.heartbeat(job.id, claimed.owner!.token)).rejects.toThrow(/Symlink/);
      await fs.unlink(dir);
      await fs.rename(`${dir}-original`, dir);
      const record = path.join(dir, 'job-v2.json');
      await fs.rename(record, `${record}.original`);
      await fs.symlink(`${record}.original`, record);
      await expect(store.get(job.id)).rejects.toThrow(/Unsafe/);
      const mapping = (await fs.readdir(root)).find(name => name.startsWith('key-') && name.endsWith('.json'))!;
      await fs.writeFile(path.join(root, mapping), '{broken');
      await expect(store.submit(input)).rejects.toThrow();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
