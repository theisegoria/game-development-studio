import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceLedger, planSourceRecord, redistributionAssessment, type SourceRecord } from '../src/provenance/ledger.js';
const roots: string[] = [];
async function setup() { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'source-ledger-'))); roots.push(dir); return { dir, ledger: await SourceLedger.open(dir) }; }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
function record(id = 'tool'): SourceRecord {
  const rights: SourceRecord['rights']['code'] = { status: 'unknown', redistribution: 'unknown', evidence: [], attribution: [], restrictions: [] };
  return { schema: 'game_dev.source_record.v1', id, kind: 'executable', name: 'Test tool', officialSource: 'https://example.com/tool', version: '1.0', contentSha256: 'a'.repeat(64), acquiredAt: '2026-10-23T00:00:00.000Z', rights: { code: structuredClone(rights), model: structuredClone(rights), output: structuredClone(rights) }, retention: { status: 'unknown', description: 'Not established', evidence: [] }, entitlement: { required: 'unknown', description: 'Not established', evidence: [] }, verification: { status: 'unverified', note: 'Not reviewed' } };
}
async function save(ledger: SourceLedger, input: unknown, expectedRevision: number) { const plan = planSourceRecord(input); return ledger.record(input, { expectedRevision, expectedSha256: plan.sha256 }); }
describe('source/license evidence ledger', () => {
  it('read-only open, inventory and SBOM do not create storage', async () => {
    const { dir } = await setup(); const nested = path.join(dir, 'absent'); const ledger = await SourceLedger.open(nested);
    expect((await ledger.inventory()).revision).toBe(0); expect((await ledger.cycloneDx()).specVersion).toBe('1.6');
    await expect(fs.stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves independent rights domains and never turns unknown or assertions into clearance', async () => {
    const { ledger } = await setup(); const input = record();
    Object.assign(input.rights.code, { status: 'allowed', redistribution: 'allowed', evidence: [{ url: 'https://example.com/license', capturedAt: input.acquiredAt, origin: 'user_assertion' }] });
    const state = await save(ledger, input, 0); const stored = state.records[0]!.record;
    expect(redistributionAssessment(stored, 'code')).toEqual({ status: 'unknown', independentlyVerified: false, authorizationGranted: false });
    expect(redistributionAssessment(stored, 'output').status).toBe('unknown');
    input.verification.status = 'evidence_reviewed';
    expect(() => planSourceRecord(input)).toThrow();
    const doc = await ledger.cycloneDx(); expect(doc.components[0]!.hashes![0]!.content).toBe('a'.repeat(64));
    expect(JSON.stringify(doc)).not.toContain('licenses'); // no invented SPDX IDs or inferred license grants
  });
  it('records documentary rights without extending them to output rights or granting authority', async () => {
    const { ledger } = await setup(); const input = record();
    input.verification = { status: 'evidence_reviewed', reviewedAt: input.acquiredAt, note: 'Operator reviewed public license file' };
    input.rights.code = { status: 'allowed', redistribution: 'allowed', evidence: [{ url: 'https://example.com/license', sha256: 'b'.repeat(64), capturedAt: input.acquiredAt, origin: 'license_file' }], attribution: ['Retain notice'], restrictions: [] };
    const stored = (await save(ledger, input, 0)).records[0]!.record;
    expect(redistributionAssessment(stored, 'code')).toEqual({ status: 'documented_declaration', independentlyVerified: false, authorizationGranted: false });
    expect(redistributionAssessment(stored, 'output').status).toBe('unknown');
    expect((await ledger.inventory()).records[0]!.record.rights.code.attribution).toEqual(['Retain notice']);
  });
  it('records local authored geometry and license bytes by content identity without claiming machine learning', async () => {
    const { ledger } = await setup(); const input = record('local.geometry'); input.kind = 'model';
    input.officialSource = `urn:sha256:${'c'.repeat(64)}`;
    input.rights.output = { status: 'allowed', redistribution: 'allowed', evidence: [{ url: `urn:sha256:${'d'.repeat(64)}`, sha256: 'd'.repeat(64), capturedAt: input.acquiredAt, origin: 'license_file' }], attribution: ['Authored locally'], restrictions: [] };
    await save(ledger, input, 0);
    const inventory = await ledger.inventory(); expect(inventory.records[0]!.record.officialSource).toBe(input.officialSource);
    const bom = await ledger.cycloneDx(); expect(bom.components[0]!.type).toBe('data');
    expect(bom.components[0]!.externalReferences[0]!.url).toBe(input.officialSource);
    expect(() => planSourceRecord({ ...input, officialSource: 'urn:sha256:invalid' })).toThrow();
    expect(() => planSourceRecord({ ...input, officialSource: '/Users/private/source.blend' })).toThrow();
    input.rights.output.evidence[0]!.sha256 = 'e'.repeat(64);
    expect(() => planSourceRecord(input)).toThrow();
  });
  it('refuses hard-linked ledger storage without modifying the other link', async () => {
    const { dir, ledger } = await setup(); await save(ledger, record(), 0);
    const file = path.join(dir, 'source-ledger.json'); const alias = path.join(dir, 'alias.json');
    await fs.link(file, alias); const before = await fs.readFile(alias, 'utf8');
    await expect(ledger.inventory()).rejects.toThrow('cannot be verified');
    await expect(save(ledger, record('next'), 1)).rejects.toThrow('cannot be verified');
    expect(await fs.readFile(alias, 'utf8')).toBe(before);
  });
  it('requires reviewed content and revision; concurrent writers cannot overwrite each other', async () => {
    const { ledger } = await setup();
    const first = record('a'), second = record('b');
    const results = await Promise.allSettled([save(ledger, first, 0), save(ledger, second, 0)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const state = await ledger.inventory(); expect(state.revision).toBe(1); expect(state.records).toHaveLength(1);
    const missing = state.records[0]!.record.id === 'a' ? second : first; await save(ledger, missing, 1);
    expect((await ledger.inventory()).records).toHaveLength(2);
    await expect(ledger.record(record(), { expectedRevision: 2, expectedSha256: '0'.repeat(64) })).rejects.toThrow('reviewed plan');
  });
  it('refuses corrupt, modified, oversized and symlink evidence instead of resetting it', async () => {
    const { ledger, dir } = await setup(); await save(ledger, record(), 0); const file = path.join(dir, 'source-ledger.json');
    const original = await fs.readFile(file, 'utf8'); await fs.writeFile(file, original.replace('Test tool', 'Tampered tool'));
    await expect(ledger.inventory()).rejects.toThrow('cannot be verified');
    await fs.writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1)); await expect(ledger.inventory()).rejects.toThrow('cannot be verified');
    await fs.rm(file); await fs.writeFile(path.join(dir, 'outside'), original); await fs.symlink(path.join(dir, 'outside'), file);
    await expect(ledger.inventory()).rejects.toThrow('cannot be verified');
    await fs.symlink(dir, path.join(dir, 'alias')); await expect(SourceLedger.open(path.join(dir, 'alias'))).rejects.toThrow('symlinks');
  });
  it('strictly refuses malformed, credential-bearing and excessive records before writes', async () => {
    const { ledger } = await setup();
    for (const officialSource of ['https://user:pass@example.com/', 'https://example.com/?token=secret', 'file:///tmp/license', 'https://example.com/#secret']) expect(() => planSourceRecord({ ...record(), officialSource })).toThrow();
    for (const name of ['password=hunter2', 'Bearer secret-token', 'api_key=abc', 'see https://user:pass@example.com/license', 'https://example.com/license?token=abc']) expect(() => planSourceRecord({ ...record(), name })).toThrow();
    expect(() => planSourceRecord({ ...record(), extra: true })).toThrow();
    expect(() => planSourceRecord({ ...record(), version: 'x'.repeat(201) })).toThrow();
    const invalid = record(); invalid.rights.code.restrictions = Array(33).fill('restricted'); expect(() => planSourceRecord(invalid)).toThrow();
    expect((await ledger.inventory()).revision).toBe(0);
  });
});
