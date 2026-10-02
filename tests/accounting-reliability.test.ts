import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SpendLedger } from '../src/storage/spend.js';
import { DurableJobStore } from '../src/jobs/durable.js';
import { createGameDevRuntime } from '../src/runtime.js';
import { JobStore } from '../src/storage/jobs.js';
import { createAssetJob } from '../src/domain/asset-job.js';
import { recoverTransactionLock } from '../src/storage/transaction.js';

const roots: string[] = [];
async function root(): Promise<string> { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'accounting-safe-')); roots.push(dir); return dir; }
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

describe('transactional accounting', () => {
  it('serializes independently opened ledgers without losing reservations', async () => {
    const dir = await root();
    const ledgers = await Promise.all(Array.from({ length: 16 }, () => SpendLedger.open(dir, 90)));
    const results = await Promise.allSettled(ledgers.map((ledger) => ledger.reserve({ tool: 'create_3d_asset' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    for (const ledger of ledgers) expect(ledger.spentCents()).toBe(90);
  });
  it('enforces the same ceiling across real Node processes', async () => {
    const dir = await root();
    const module = pathToFileURL(path.resolve('dist/storage/spend.js')).href;
    const script = `import {SpendLedger} from ${JSON.stringify(module)}; const ledger = await SpendLedger.open(process.argv[1], 60); try { await ledger.reserve({tool:'create_3d_asset'}); process.stdout.write('reserved'); } catch(e) { if(e.code !== 'SPEND_LIMIT_EXCEEDED') throw e; process.stdout.write('refused'); }`;
    const output = await Promise.all(Array.from({ length: 8 }, () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir]); let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    })));
    expect(output.filter((value) => value === 'reserved')).toHaveLength(2);
    expect((await SpendLedger.open(dir)).spentCents()).toBe(60);
  });
  it.each(['{broken', JSON.stringify({ schemaVersion: 2, entries: [] }), JSON.stringify({ schemaVersion: 1, entries: [{ estimatedCents: -100 }] })])('fails closed on invalid bookkeeping while exposing diagnostics: %s', async (raw) => {
    const dir = await root(); const file = path.join(dir, 'spend-ledger.json'); await fs.writeFile(file, raw);
    const ledger = await SpendLedger.open(dir);
    expect(ledger.diagnostics().healthy).toBe(false);
    expect(() => ledger.assertHeadroom('create_3d_asset')).toThrow(/blocked/);
    await expect(ledger.reserve({ tool: 'create_3d_asset' })).rejects.toThrow(/blocked/);
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
  });
  it('preserves the balance boundary after ledger deletion and a fresh process-style reopen', async () => {
    const dir = await root(); const first = await SpendLedger.open(dir, 100);
    await first.reserve({ tool: 'create_3d_asset' });
    await fs.unlink(path.join(dir, 'spend-ledger.json'));
    const reopened = await SpendLedger.open(dir, 100);
    expect(reopened.diagnostics().healthy).toBe(false);
    await expect(reopened.reserve({ tool: 'create_3d_asset' })).rejects.toThrow(/blocked/);
    expect(await fs.readFile(path.join(dir, 'spend-ledger.json.present'), 'utf8')).toContain('game_dev.spend_presence.v1');
  });
  it('backfills presence evidence for a valid legacy ledger', async () => {
    const dir = await root(); const file = path.join(dir, 'spend-ledger.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, entries: [] }));
    expect((await SpendLedger.open(dir)).diagnostics().healthy).toBe(true);
    await fs.unlink(file);
    expect((await SpendLedger.open(dir)).diagnostics().healthy).toBe(false);
  });
  it('does not lose same-instance transactions when diagnostics refresh during asynchronous writes', async () => {
    const ledger = await SpendLedger.open(await root(), 300);
    const refresh = setInterval(() => { ledger.diagnostics(); }, 1);
    try {
      const results = await Promise.allSettled(Array.from({ length: 16 }, () => ledger.reserve({ tool: 'create_3d_asset' })));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
      expect(ledger.spentCents()).toBe(300);
      const entries = ledger.history().entries;
      await Promise.all(entries.slice(0, 5).map((entry) => ledger.release(entry.id)));
      expect(ledger.spentCents()).toBe(150);
      expect(ledger.history().entries).toHaveLength(10);
      expect(ledger.history().entries.filter((entry) => entry.releasedAt)).toHaveLength(5);
    } finally { clearInterval(refresh); }
  });
  it('fails closed on a truncated presence marker and unsafe combined totals', async () => {
    const dir = await root(); const ledger = await SpendLedger.open(dir);
    const first = await ledger.reserve({ tool: 'create_3d_asset' });
    await ledger.reconcile(first.entryId, Number.MAX_SAFE_INTEGER);
    await expect(ledger.reserve({ tool: 'create_3d_asset' })).rejects.toThrow(/safe accounting/);
    expect(ledger.history().entries).toHaveLength(1);
    await fs.writeFile(path.join(dir, 'spend-ledger.json.present'), '{partial');
    const reopened = await SpendLedger.open(dir);
    expect(reopened.diagnostics().healthy).toBe(false);
    await expect(reopened.reserve({ tool: 'create_3d_asset' })).rejects.toThrow(/blocked/);
  });
  it('refuses duplicate job submissions, retains released evidence, and does not invent invoice charges', async () => {
    const ledger = await SpendLedger.open(await root(), 100);
    const reservation = await ledger.reserve({ tool: 'create_3d_asset', assetJobId: 'asset_abc', approval: { source: 'test invocation', at: new Date().toISOString() } });
    await expect(ledger.reserve({ tool: 'create_3d_asset', assetJobId: 'asset_abc' })).rejects.toThrow(/already exists/);
    expect(ledger.history().providers[0]).toMatchObject({ reportedCents: null, failureRate: null, unknownChargeCount: 1 });
    await ledger.recordOutcome(reservation.entryId, 'failed'); await ledger.rate(reservation.entryId, 2, 'Missing details');
    expect(ledger.history().providers[0]).toMatchObject({ failureRate: 1, meanUserRating: 2, reportedCents: null });
    await ledger.release(reservation.entryId);
    expect(ledger.spentCents()).toBe(0); expect(ledger.history().entries[0]?.releasedAt).toBeTruthy();
  });
  it('charges the ceiling conservatively when actual reported charge exceeds the estimate', async () => {
    const ledger = await SpendLedger.open(await root(), 60); const reservation = await ledger.reserve({ tool: 'create_3d_asset' });
    await ledger.reconcile(reservation.entryId, 45);
    expect(ledger.summary().spentCents).toBe(45);
    await expect(ledger.reserve({ tool: 'create_3d_asset' })).rejects.toMatchObject({ code: 'SPEND_LIMIT_EXCEEDED' });
    await expect(ledger.reconcile(reservation.entryId, NaN)).rejects.toThrow();
    await expect(ledger.release(reservation.entryId)).rejects.toThrow(/provider-reported/);
  });
  it('records invocation provenance without claiming independently verified human approval', async () => {
    const runtime = await createGameDevRuntime({ outputDir: await root(), env: { ASSET_LOG_LEVEL: 'silent', ASSET_SPEND_LIMIT_CENTS: '100' } });
    await runtime.context.charge('create_3d_asset');
    expect(runtime.spend.history().entries[0]?.approval).toMatchObject({ userApprovalVerified: false });
    expect(await runtime.context.store.list()).toEqual([]);
    expect(runtime.context.store.lastListingSkipped()).toEqual([]);
  });
  it('never recovers a live worker lock', async () => {
    const target = path.join(await root(), 'ledger');
    await fs.writeFile(`${target}.lock`, JSON.stringify({ schema: 'game_dev.lock.v1', host: os.hostname(), pid: process.pid }));
    await expect(recoverTransactionLock(target, true)).rejects.toThrow(/still alive/);
    expect(await fs.stat(`${target}.lock`)).toBeTruthy();
  });
});

describe('durable evidence and replay safety', () => {
  it('validates complete schemas and exposes skipped corruption', async () => {
    const dir = await root(); const store = await DurableJobStore.open(dir); const job = await store.create('asset.normalize', {});
    await fs.writeFile(path.join(dir, job.id, 'job.json'), JSON.stringify({ ...job, status: 'surprise', attempts: -1 }));
    await expect(store.get(job.id)).rejects.toThrow(/corrupt/);
    expect(await store.list()).toEqual([]); expect(store.lastListingSkipped()[0]?.id).toBe(job.id);
    expect((await store.diagnostics()).corrupt).toHaveLength(1);
  });
  it('quarantines original corruption as evidence and seals replay', async () => {
    const dir = await root(); const store = await DurableJobStore.open(dir); const job = await store.create('provider.tripo.generate', {});
    const file = path.join(dir, job.id, 'job.json'); await fs.writeFile(file, '{damaged accounting context');
    await expect(store.quarantineCorrupt(job.id, false)).rejects.toThrow(/confirmation/);
    const recovered = await store.quarantineCorrupt(job.id, true);
    expect((await store.get(job.id)).status).toBe('cancelled');
    const evidence = JSON.parse(await fs.readFile(String(recovered.request.evidencePath), 'utf8'));
    expect(evidence.jobRaw).toBe('{damaged accounting context');
    await expect(store.create('provider.tripo.generate', {}, { parentJobId: job.id })).rejects.toThrow(/replayed/);
  });
  it('permits only one worker to start and never silently restarts a running job', async () => {
    const dir = await root(); const a = await DurableJobStore.open(dir); const b = await DurableJobStore.open(dir); const job = await a.create('asset.normalize', {});
    const results = await Promise.allSettled([a.markRunning(job.id), b.markRunning(job.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await a.diagnostics(0)).stale).toHaveLength(1);
    await expect(a.recover(job.id, false)).rejects.toThrow(/confirmation/);
    expect((await a.recover(job.id, true)).status).toBe('cancelled');
    await expect(a.create(job.operation, {}, { parentJobId: job.id })).rejects.toThrow(/replayed/);
  });
  it('blocks paid retries after uncertain failure and serializes local retry claims', async () => {
    const store = await DurableJobStore.open(await root()); const paid = await store.create('provider.tripo.generate', {});
    await store.markRunning(paid.id); await store.fail(paid.id, { message: 'connection lost after submission' });
    await expect(store.create(paid.operation, {}, { parentJobId: paid.id })).rejects.toThrow(/uncertain/);
    const genericPaid = await store.create('tool.call.create_3d_asset', {}); await store.markRunning(genericPaid.id); await store.fail(genericPaid.id, { message: 'unknown submission' });
    await expect(store.create(genericPaid.operation, {}, { parentJobId: genericPaid.id })).rejects.toThrow(/uncertain/);
    const local = await store.create('asset.normalize', {}); await store.fail(local.id, { message: 'local failure' });
    const results = await Promise.allSettled([store.create(local.operation, {}, { parentJobId: local.id }), store.create(local.operation, {}, { parentJobId: local.id })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await store.get(local.id)).supersededByJobId).toBeTruthy();
  });
});


describe('complete asset job validation', () => {
  it.each([
    { status: 'future-status' }, { createdAt: null }, { candidates: [null] },
    { files: [{ path: 'asset.glb', bytes: -1, sha256: 'invalid', kind: 'model' }] },
    { model3d: { provider: 'tripo', providerTaskId: 42 } },
    { audio: { provider: 'leonardo', requestedAt: [] } },
    { selectedCandidateId: 'missing' }, { spec: { name: 'missing-description' } },
    { id: 'asset_other-identity' },
  ])('surfaces invalid records instead of crashing downstream: %j', async (changes) => {
    const dir = await root(); const store = await JobStore.open(dir);
    const job = createAssetJob({ spec: { name: 'crate', description: 'wood crate' }, slug: 'crate' });
    await fs.writeFile(path.join(dir, `${job.id}.json`), JSON.stringify({ ...job, ...changes }));
    await expect(store.get(job.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await store.list()).toEqual([]); expect(store.lastListingSkipped()).toHaveLength(1);
    await expect(store.findByProviderTaskId('unknown-task')).rejects.toThrow(/lookup is incomplete/);
  });
  it('refuses invalid saves without replacing valid provenance', async () => {
    const store = await JobStore.open(await root());
    const job = createAssetJob({ spec: { name: 'crate', description: 'wood crate' }, slug: 'crate' });
    await store.save(job);
    await expect(store.save({ ...job, createdAt: 'not a timestamp' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await store.get(job.id)).toEqual(job);
  });
});
