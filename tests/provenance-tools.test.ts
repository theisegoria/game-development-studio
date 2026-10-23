import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { connectTools, type ToolClient } from './helpers/tool-harness.js';
import { registerProvenanceTools } from '../src/tools/provenance.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
function record(id = 'source') {
  const rights = { status: 'unknown', redistribution: 'unknown', evidence: [], attribution: [], restrictions: [] };
  return { schema: 'game_dev.source_record.v1', id, kind: 'recipe_dependency', name: 'Authored recipe', officialSource: `urn:sha256:${'a'.repeat(64)}`, version: '1.0', acquiredAt: '2026-10-23T00:00:00.000Z', rights: { code: rights, model: rights, output: rights }, retention: { status: 'unknown', description: 'Not established', evidence: [] }, entitlement: { required: 'unknown', description: 'Not established', evidence: [] }, verification: { status: 'unverified', note: 'Not reviewed' } };
}
async function setup() { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'provenance-tools-'))); roots.push(dir); return { dir, client: await connectTools(registerProvenanceTools, dir) }; }
async function save(client: ToolClient, input = record()) {
  const planned = await client.call('plan_source_record', { record: input }); expect(planned.isError).toBe(false);
  const result = await client.call('record_source_evidence', { record: input, expectedRevision: planned.payload.expectedRevision, expectedSha256: planned.payload.sha256 }); expect(result.isError).toBe(false); return result;
}
describe('registered provenance operations', () => {
  it('read-only planning/inspection do not create provenance files and summaries are bounded', async () => {
    const { dir, client } = await setup(); const plan = await client.call('plan_source_record', { record: record() });
    expect(plan.payload.expectedRevision).toBe(0); expect(plan.payload.sha256).toMatch(/^[a-f0-9]{64}$/);
    const empty = await client.call('inspect_source_ledger', {}); expect(empty.payload.total).toBe(0);
    await expect(fs.stat(path.join(dir, '.provenance'))).rejects.toMatchObject({ code: 'ENOENT' });
    await save(client, record('first')); await save(client, record('second'));
    const list = await client.call('inspect_source_ledger', { limit: 1 });
    expect(list.payload.total).toBe(2); expect(list.payload.nextOffset).toBe(1);
    const summaries = list.payload.records as Record<string, unknown>[]; expect(summaries).toHaveLength(1); expect(summaries[0]!.officialSource).toBeUndefined();
    expect(summaries[0]!.uri).toMatch(/^game-dev:\/\/sources\/records\/first\/[a-f0-9]{64}$/);
    const detail = await client.call('inspect_source_ledger', { id: 'first' }); expect(detail.payload.record).toMatchObject({ id: 'first', officialSource: record().officialSource });
    expect((await client.call('inspect_source_ledger', { id: 'absent' })).isError).toBe(true);
  });
  it('binds writes and exports to exact plans; exports bytes once and verifies reuse', async () => {
    const { client } = await setup(); await save(client);
    const inspect = await client.call('inspect_source_ledger', {}); const plans = inspect.payload.exportPlans as Record<string, unknown>[];
    for (const plan of plans) {
      const { bytes, ...input } = plan; const exported = await client.call('export_source_ledger', input); expect(exported.isError).toBe(false);
      const file = exported.payload.file as string; const data = await fs.readFile(file);
      expect(data.length).toBe(bytes); expect(createHash('sha256').update(data).digest('hex')).toBe(plan.expectedSha256);
      const concurrent = await Promise.all([client.call('export_source_ledger', input), client.call('export_source_ledger', input)]); expect(concurrent.every(result => !result.isError && result.payload.reused === true)).toBe(true);
      await fs.writeFile(file, 'tampered'); expect((await client.call('export_source_ledger', input)).isError).toBe(true);
    }
    const stale = plans[0]!; await save(client, record('new'));
    const { bytes: _bytes, ...input } = stale; expect((await client.call('export_source_ledger', input)).isError).toBe(true);
    const planned = await client.call('plan_source_record', { record: record() });
    expect((await client.call('record_source_evidence', { record: { ...record(), version: 'changed' }, expectedRevision: planned.payload.expectedRevision, expectedSha256: planned.payload.sha256 })).isError).toBe(true);
  });
  it('refuses symlink private directories and exports without writing outside the fixed root', async () => {
    const { dir, client } = await setup(); const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(dir, '.provenance'));
    expect((await client.call('plan_source_record', { record: record() })).isError).toBe(true);
    await fs.rm(path.join(dir, '.provenance')); await save(client);
    const inspect = await client.call('inspect_source_ledger', {}); const plan = (inspect.payload.exportPlans as Record<string, unknown>[])[0]!;
    const { bytes: _bytes, ...input } = plan; await fs.symlink(outside, path.join(dir, '.provenance', 'exports'));
    expect((await client.call('export_source_ledger', input)).isError).toBe(true); expect(await fs.readdir(outside)).toEqual([]);
    await fs.rm(path.join(dir, '.provenance', 'exports')); await fs.mkdir(path.join(dir, '.provenance', 'exports'));
    const file = path.join(dir, '.provenance', 'exports', `inventory-${plan.expectedSha256}.json`); const external = path.join(outside, 'file'); await fs.writeFile(external, 'unchanged'); await fs.symlink(external, file);
    expect((await client.call('export_source_ledger', input)).isError).toBe(true); expect(await fs.readFile(external, 'utf8')).toBe('unchanged');
  });
  it('strict transport validation rejects unknown arguments, credentials, and invalid pagination before writes', async () => {
    const { dir, client } = await setup();
    for (const args of [{ record: record(), approve: true }, { record: { ...record(), officialSource: 'https://user:pass@example.com/' } }]) expect((await client.call('plan_source_record', args)).isError).toBe(true);
    expect((await client.call('record_source_evidence', { record: record(), expectedRevision: 0, expectedSha256: 'a'.repeat(64), outputPath: '/tmp/escape' })).isError).toBe(true);
    expect((await client.call('inspect_source_ledger', { limit: 101 })).isError).toBe(true);
    await expect(fs.stat(path.join(dir, '.provenance'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
