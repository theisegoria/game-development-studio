import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { planGeneralizedPackage, buildGeneralizedPackage } from '../src/packages/format-v2.js';
import { admitVendorPackage } from '../src/packages/vendor.js';
import { buildAssetPackage } from '../src/packages/format.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
import { SourceLedger, planSourceRecord, type SourceRecord } from '../src/provenance/ledger.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup(rightsStatus: 'allowed' | 'denied' | 'unknown' = 'allowed') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vendor-v2-'))); roots.push(root);
  const projectRoot = path.join(root, 'game'); await fs.mkdir(projectRoot);
  const sourceLedgerDirectory = path.join(root, 'ledger'); const ledger = await SourceLedger.open(sourceLedgerDirectory);
  const blank: SourceRecord['rights']['code'] = { status: 'unknown', redistribution: 'unknown', attribution: [], restrictions: [], evidence: [] };
  const record: SourceRecord = { schema: 'game_dev.source_record.v1', id: 'authored.audio', kind: 'asset', name: 'Local source', officialSource: `urn:sha256:${'a'.repeat(64)}`, version: '1', acquiredAt: '2026-10-23T00:00:00.000Z', rights: { code: blank, model: blank, output: { status: rightsStatus, redistribution: rightsStatus, attribution: [], restrictions: [], evidence: [{ origin: 'license_file', url: `urn:sha256:${'b'.repeat(64)}`, capturedAt: '2026-10-23T00:00:00.000Z' }] } }, retention: { status: 'not_applicable', description: 'Local', evidence: [] }, entitlement: { required: 'no', description: 'Authored', evidence: [] }, verification: { status: 'evidence_reviewed', reviewedAt: '2026-10-23T00:00:00.000Z', note: 'Recorded review, no independent clearance' } };
  const plannedRecord = planSourceRecord(record); await ledger.record(record, { expectedRevision: 0, expectedSha256: plannedRecord.sha256 });
  const source = path.join(root, 'sound.wav'); await fs.writeFile(source, Buffer.from('local deterministic audio fixture'));
  async function build(name: string) {
    const request = { kind: 'audio', name, primary: 'sound.wav', license: 'CC0-1.0', provenance: { origin: 'authored', references: [{ sourceId: record.id, recordSha256: plannedRecord.sha256 }] }, artifacts: [{ path: 'sound.wav', role: 'audio', sourcePath: source }] };
    const plan = await planGeneralizedPackage(request, path.join(root, 'packages'));
    return buildGeneralizedPackage(request, path.join(root, 'packages'), plan.fingerprint);
  }
  return { root, projectRoot, sourceLedgerDirectory, ledger, record, build };
}
it('keeps v2 audio as primary audio, binds plan, copies/verifies, and writes v2 lock/receipt without model fields', async () => {
  const context = await setup(); const built = await context.build('Footstep'); const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory };
  const plan = await admitVendorPackage(options); expect(plan.dryRun).toBe(true); expect(plan.blockers).toEqual([]);
  await expect(fs.stat(path.join(context.projectRoot, '.game-dev'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(admitVendorPackage({ ...options, confirm: true })).rejects.toThrow('fingerprint');
  const result = await admitVendorPackage({ ...options, confirm: true, expectedFingerprint: plan.plan!.fingerprint }); expect(result.dryRun).toBe(false);
  const lock = JSON.parse(await fs.readFile(result.lockPath, 'utf8')); const receipt = JSON.parse(await fs.readFile(result.receiptPath!, 'utf8'));
  expect(lock.schema).toBe('game_dev.vendor_lock.v2'); expect(lock.entries[0]).toMatchObject({ kind: 'audio', primary: { path: 'sound.wav' } }); expect(lock.entries[0].modelSha256).toBeUndefined(); expect(receipt.schema).toBe('game_dev.vendor_receipt.v2');
  expect(await fs.readFile(path.join(result.destination, 'sound.wav'))).toEqual(await fs.readFile(path.join(built.packagePath, 'sound.wav')));
});
it('blocks missing/unknown rights despite known license, and denied rights even with reviewed override', async () => {
  for (const status of ['unknown', 'denied'] as const) {
    const context = await setup(status); const built = await context.build(status);
    const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory, confirm: true };
    expect((await admitVendorPackage(options)).blockers.length).toBeGreaterThan(0);
    const overridden = await admitVendorPackage({ ...options, confirm: false, allowUnknownLicense: true });
    expect(overridden.blockers.length === 0).toBe(status === 'unknown');
    expect((await admitVendorPackage({ ...options, sourceLedgerDirectory: undefined })).blockers.length).toBeGreaterThan(0);
  }
});
it('serializes concurrent lock updates and refuses source-ledger or destination drift', async () => {
  const context = await setup(); const first = await context.build('First'), second = await context.build('Second');
  const options = (packagePath: string) => ({ packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory });
  const a = await admitVendorPackage(options(first.packagePath)); const b = await admitVendorPackage(options(second.packagePath));
  await Promise.all([admitVendorPackage({ ...options(first.packagePath), confirm: true, expectedFingerprint: a.plan!.fingerprint }), admitVendorPackage({ ...options(second.packagePath), confirm: true, expectedFingerprint: b.plan!.fingerprint })]);
  const lock = JSON.parse(await fs.readFile(a.lockPath, 'utf8')); expect(lock.entries).toHaveLength(2);
  const third = await context.build('Third'); const c = await admitVendorPackage(options(third.packagePath));
  const changed = { ...context.record, version: '2' }; await context.ledger.record(changed, { expectedRevision: 1, expectedSha256: planSourceRecord(changed).sha256 });
  expect((await admitVendorPackage({ ...options(third.packagePath), confirm: true, expectedFingerprint: c.plan!.fingerprint })).dryRun).toBe(true);
  await fs.writeFile(path.join(first.packagePath, 'sound.wav'), 'tampered'); await expect(admitVendorPackage(options(first.packagePath))).rejects.toThrow();
});
it('refuses symlink destination parents and preexisting conflicting destinations', async () => {
  const context = await setup(); const built = await context.build('Safe'); const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory };
  const outside = path.join(context.root, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, path.join(context.projectRoot, 'Assets'));
  await expect(admitVendorPackage(options)).rejects.toThrow('symlink'); expect(await fs.readdir(outside)).toEqual([]);
  await fs.rm(path.join(context.projectRoot, 'Assets')); const planned = await admitVendorPackage(options);
  await fs.mkdir(planned.destination, { recursive: true }); await fs.writeFile(path.join(planned.destination, 'keep.txt'), 'user data');
  const result = await admitVendorPackage({ ...options, confirm: true, expectedFingerprint: planned.plan!.fingerprint }); expect(result.dryRun).toBe(true); expect(await fs.readFile(path.join(planned.destination, 'keep.txt'), 'utf8')).toBe('user data');
});

it('preserves legacy entries when upgrading the lock and retains v1 writes after v2', async () => {
  const context = await setup(); const legacy = await buildAssetPackage({ packagesRoot: path.join(context.root, 'packages-v1'), sourcePath: await writeGameReadyGlb(path.join(context.root, 'source.glb')), name: 'Legacy', license: 'CC0-1.0' });
  const legacyOptions = { packagePath: legacy.packagePath, projectRoot: context.projectRoot, confirm: true };
  const first = await admitVendorPackage(legacyOptions); const oldLock = JSON.parse(await fs.readFile(first.lockPath, 'utf8')); expect(oldLock.schema).toBe('game_dev.vendor_lock.v1');
  const built = await context.build('Sound'); const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory }; const plan = await admitVendorPackage(options);
  const admitted = await admitVendorPackage({ ...options, confirm: true, expectedFingerprint: plan.plan!.fingerprint });
  const mixed = JSON.parse(await fs.readFile(admitted.lockPath, 'utf8')); expect(mixed.schema).toBe('game_dev.vendor_lock.v2'); expect(mixed.entries).toContainEqual(oldLock.entries[0]);
  await admitVendorPackage(legacyOptions); const retained = JSON.parse(await fs.readFile(admitted.lockPath, 'utf8')); expect(retained.schema).toBe('game_dev.vendor_lock.v2'); expect(retained.entries).toHaveLength(2);
});
it('refuses corrupt or hardlinked locks before copying and preserves external bytes', async () => {
  const context = await setup(); const built = await context.build('Protected'); const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory }; const plan = await admitVendorPackage(options);
  await fs.mkdir(path.dirname(plan.lockPath), { recursive: true }); await fs.writeFile(plan.lockPath, 'corrupt');
  await expect(admitVendorPackage({ ...options, confirm: true, expectedFingerprint: plan.plan!.fingerprint })).rejects.toThrow();
  await expect(fs.stat(plan.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.writeFile(plan.lockPath, JSON.stringify({ schema: 'game_dev.vendor_lock.v1', entries: [] })); const alias = path.join(context.root, 'external-lock'); await fs.link(plan.lockPath, alias);
  await expect(admitVendorPackage({ ...options, confirm: true, expectedFingerprint: plan.plan!.fingerprint })).rejects.toThrow('single-link');
  expect(JSON.parse(await fs.readFile(alias, 'utf8')).entries).toEqual([]); await expect(fs.stat(plan.destination)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('cannot use a stale record hash plus unknown-rights override to bypass a current denial', async () => {
  const context = await setup(); const built = await context.build('Changed Rights');
  const denied = structuredClone(context.record); denied.rights.output.status = 'denied'; denied.rights.output.redistribution = 'denied';
  await context.ledger.record(denied, { expectedRevision: 1, expectedSha256: planSourceRecord(denied).sha256 });
  const plan = await admitVendorPackage({ packagePath: built.packagePath, projectRoot: context.projectRoot, allowInvalid: true, sourceLedgerDirectory: context.sourceLedgerDirectory, allowUnknownLicense: true });
  expect(plan.blockers.join(' ')).toContain('denies output');
});

it('blocks unknown license and declared-only primary validation unless separately reviewed overrides are bound', async () => {
  const context = await setup(); const built = await context.build('Declared only');
  const options = { packagePath: built.packagePath, projectRoot: context.projectRoot, sourceLedgerDirectory: context.sourceLedgerDirectory };
  const strict = await admitVendorPackage(options); expect(strict.blockers.join(' ')).toContain('not performed');
  const reviewed = await admitVendorPackage({ ...options, allowInvalid: true }); expect(reviewed.blockers).toEqual([]);
  expect(reviewed.plan!.fingerprint).not.toBe(strict.plan!.fingerprint);
  await expect(admitVendorPackage({ ...options, allowInvalid: true, confirm: true, expectedFingerprint: strict.plan!.fingerprint })).rejects.toThrow('fingerprint');
  const source = path.join(context.root, 'unknown-license.wav'); await fs.writeFile(source, 'local audio bytes');
  const request = { kind: 'audio', name: 'Unknown license', primary: 'audio.wav', provenance: { references: [{ sourceId: context.record.id, recordSha256: planSourceRecord(context.record).sha256 }] }, artifacts: [{ path: 'audio.wav', role: 'audio', sourcePath: source }] };
  const planned = await planGeneralizedPackage(request, path.join(context.root, 'packages')); const unknown = await buildGeneralizedPackage(request, path.join(context.root, 'packages'), planned.fingerprint);
  const licensePlan = await admitVendorPackage({ ...options, packagePath: unknown.packagePath, allowInvalid: true }); expect(licensePlan.blockers.join(' ')).toContain('license is unknown');
  const override = await admitVendorPackage({ ...options, packagePath: unknown.packagePath, allowInvalid: true, allowUnknownLicense: true }); expect(override.blockers).toEqual([]); expect(override.plan!.fingerprint).not.toBe(licensePlan.plan!.fingerprint);
});
