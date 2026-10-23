import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetCatalog } from '../src/packages/catalog.js';
import { buildAssetPackage, readAssetPackage } from '../src/packages/format.js';
import { buildGeneralizedPackage, planGeneralizedPackage } from '../src/packages/format-v2.js';
import { readPackage, packagePrimaryArtifact, packageArtifactFiles } from '../src/packages/reader.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-v2-')); roots.push(root); return root; }
function createV1(file: string) {
  const database = new DatabaseSync(file);
  database.exec(`CREATE TABLE catalog_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    INSERT INTO catalog_meta VALUES ('schema','game_dev.catalog.v1'),('database_version','1');
    CREATE TABLE assets(package_id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,version TEXT NOT NULL,
    display_name TEXT NOT NULL,description TEXT,category TEXT,license TEXT NOT NULL,package_path TEXT NOT NULL UNIQUE,
    model_path TEXT NOT NULL,preview_path TEXT,model_sha256 TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,
    validation_passed INTEGER NOT NULL,validation_errors INTEGER NOT NULL,validation_warnings INTEGER NOT NULL,
    origin TEXT NOT NULL,provider TEXT,indexed_at TEXT NOT NULL,search_text TEXT NOT NULL) STRICT;`);
  database.close();
}
async function mesh(root: string, name = 'Crate') {
  return buildAssetPackage({ packagesRoot: path.join(root, 'packages'), sourcePath: await writeGameReadyGlb(path.join(root, `${name}.glb`)), name, license: 'CC0-1.0' });
}
async function audio(root: string) {
  const sourcePath = path.join(root, 'source.wav'); await fs.writeFile(sourcePath, 'declared audio fixture');
  const request = { kind: 'audio', name: 'Tone', primary: 'audio/tone.wav', license: 'CC0-1.0', artifacts: [{ path: 'audio/tone.wav', role: 'audio', sourcePath }] };
  const plan = await planGeneralizedPackage(request, path.join(root, 'packages'));
  return buildGeneralizedPackage(request, path.join(root, 'packages'), plan.fingerprint);
}

describe('shared package reader and catalog compatibility', () => {
  it('dispatches actual schemas and preserves legacy reads while indexing non-model primaries', async () => {
    const root = await workspace(), old = await mesh(root), sound = await audio(root);
    expect(await readPackage(old.packagePath)).toEqual(await readAssetPackage(old.packagePath));
    const manifest = await readPackage(sound.packagePath);
    expect(manifest.schema).toBe('game_dev.asset_package.v2');
    expect(packagePrimaryArtifact(manifest)).toMatchObject({ path: 'audio/tone.wav', bytes: 22 });
    expect(packageArtifactFiles(manifest)).toHaveLength(1);
    const databasePath = path.join(root, 'catalog.sqlite');
    const absent = await AssetCatalog.planMigration(databasePath);
    expect(absent).toMatchObject({ needsMigration: false, currentVersion: 0, targetVersion: 2 });
    await expect(fs.access(databasePath)).rejects.toThrow();
    const catalog = await AssetCatalog.open(databasePath);
    try {
      expect(catalog.supportsGeneralizedPackages).toBe(true);
      const legacy = await catalog.admit(old.packagePath), generalized = await catalog.admit(sound.packagePath);
      expect(legacy.modelPath).toBe(path.join(await fs.realpath(old.packagePath), 'model.glb'));
      expect(legacy).not.toHaveProperty('kind');
      expect(generalized).toMatchObject({ kind: 'audio', primaryPath: path.join(sound.packagePath, 'audio/tone.wav'), validationPassed: false });
      expect(generalized).not.toHaveProperty('modelPath'); expect(generalized).not.toHaveProperty('modelSha256');
      expect(catalog.get(generalized.packageId)).toEqual(generalized);
    } finally { catalog.close(); }
    const rebuild = await AssetCatalog.rebuild(databasePath, path.join(root, 'packages'));
    expect(rebuild.indexed).toHaveLength(2); expect(rebuild.backupPath).toBeTruthy();
  });
  it('rejects symlink/oversized/unknown manifest discriminators before dispatch', async () => {
    const root = await workspace(), pkg = path.join(root, 'package'); await fs.mkdir(pkg);
    const target = path.join(pkg, 'manifest.json'), outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, '{}'); await fs.symlink(outside, target);
    await expect(readPackage(pkg)).rejects.toThrow(); await fs.unlink(target);
    await fs.writeFile(target, 'x'.repeat(1024 * 1024 + 1)); await expect(readPackage(pkg)).rejects.toThrow(/bounded/);
    await fs.writeFile(target, JSON.stringify({ schema: 'game_dev.asset_package.v99' })); await expect(readPackage(pkg)).rejects.toThrow(/Unsupported/);
  });
});

describe('explicit catalog migration and rollback', () => {
  it('keeps v1 usable until approved migration, preserves sealed bytes, and rolls back from its bound backup', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const old = await mesh(root), sound = await audio(root), manifestBefore = await fs.readFile(old.manifestPath);
    const catalog = await AssetCatalog.open(file);
    expect(catalog.schemaVersion).toBe(1); expect(catalog.supportsGeneralizedPackages).toBe(false);
    const legacy = await catalog.admit(old.packagePath);
    expect(() => catalog.assertSupportsPackageSchema('game_dev.asset_package.v2')).toThrow(/CATALOG_MIGRATION_REQUIRED/);
    await expect(catalog.admit(sound.packagePath)).rejects.toThrow(/migration/);
    const active = await AssetCatalog.planMigration(file);
    expect(active.activeHandles).toHaveLength(1);
    await expect(AssetCatalog.migrate(file, { expectedFingerprint: active.fingerprint, confirm: true })).rejects.toThrow(/handles/);
    catalog.close();
    const before = await fs.readFile(file), plan = await AssetCatalog.planMigration(file);
    expect(await fs.readFile(file)).toEqual(before);
    await expect(AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: false })).rejects.toThrow(/confirmation/);
    const migrated = await AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: true });
    expect(await fs.readFile(old.manifestPath)).toEqual(manifestBefore);
    const upgraded = await AssetCatalog.open(file);
    expect(upgraded.get(legacy.packageId)).toEqual(legacy);
    await upgraded.admit(sound.packagePath); upgraded.close();
    let rollbackPlan = await AssetCatalog.planRollback(file, migrated.backupPath);
    const drifted = new DatabaseSync(file); drifted.exec("UPDATE assets SET description='changed derived index'"); drifted.close();
    await expect(AssetCatalog.rollback(file, migrated.backupPath, { expectedFingerprint: rollbackPlan.expectedFingerprint, confirm: true })).rejects.toThrow(/drift/);
    rollbackPlan = await AssetCatalog.planRollback(file, migrated.backupPath);
    expect(rollbackPlan.targetVersion).toBe(1);
    await expect(AssetCatalog.rollback(file, migrated.backupPath, { expectedFingerprint: rollbackPlan.expectedFingerprint, confirm: false })).rejects.toThrow();
    const rolledBack = await AssetCatalog.rollback(file, migrated.backupPath, { expectedFingerprint: rollbackPlan.expectedFingerprint, confirm: true });
    expect(rolledBack.backupPath).not.toBe(migrated.backupPath);
    const restored = await AssetCatalog.open(file);
    expect(restored.schemaVersion).toBe(1); expect(restored.list()).toEqual([legacy]); restored.close();
    await expect(AssetCatalog.planRollback(file, path.join(root, 'arbitrary.db'))).rejects.toThrow();
    await fs.appendFile(migrated.backupPath, 'tamper');
    await expect(AssetCatalog.planRollback(file, migrated.backupPath)).rejects.toThrow(/hash/);
  });
  it('rejects drift/newer versions and rolls back a failed atomic replacement without losing the source', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const planned = await AssetCatalog.planMigration(file);
    const old = await mesh(root), handle = await AssetCatalog.open(file); await handle.admit(old.packagePath); handle.close();
    await expect(AssetCatalog.migrate(file, { expectedFingerprint: planned.fingerprint, confirm: true })).rejects.toThrow(/drift/);
    const plan = await AssetCatalog.planMigration(file), before = await fs.readFile(file), realRename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes('.migrate-') && String(to) === file) throw new Error('simulated atomic replacement failure');
      return realRename(from, to);
    });
    await expect(AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: true })).rejects.toThrow(/simulated/);
    spy.mockRestore(); expect(await fs.readFile(file)).toEqual(before);
    expect((await AssetCatalog.planMigration(file)).currentVersion).toBe(1);
    expect((await fs.readdir(root)).some(name => name.includes('.backup-'))).toBe(true);
    expect((await fs.readdir(root)).some(name => name.includes('.migrate-'))).toBe(false);
    const database = new DatabaseSync(file); database.exec("UPDATE catalog_meta SET value='99' WHERE key='database_version'"); database.close();
    const newer = await fs.readFile(file);
    await expect(AssetCatalog.open(file)).rejects.toThrow(/Unsupported/);
    await expect(AssetCatalog.planMigration(file)).rejects.toThrow(/Unsupported/);
    expect(await fs.readFile(file)).toEqual(newer);
  });
  it('refuses an unmanaged active SQLite writer and preserves the approved source', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const plan = await AssetCatalog.planMigration(file), source = await fs.readFile(file);
    const writer = new DatabaseSync(file); writer.exec('BEGIN IMMEDIATE');
    try {
      await expect(AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: true })).rejects.toThrow(/locked/);
    } finally { writer.exec('ROLLBACK'); writer.close(); }
    expect(await fs.readFile(file)).toEqual(source);
    expect((await AssetCatalog.planMigration(file)).currentVersion).toBe(1);
  });
  it('binds approval to the destination and exact lease identity instead of identical database bytes', async () => {
    const root = await workspace(), first = path.join(root, 'first.sqlite'), second = path.join(root, 'second.sqlite'); createV1(first);
    await fs.copyFile(first, second);
    const approved = await AssetCatalog.planMigration(first), redirected = await AssetCatalog.planMigration(second);
    expect(redirected.sourceFingerprint).toBe(approved.sourceFingerprint);
    expect(redirected.fingerprint).not.toBe(approved.fingerprint);
    await expect(AssetCatalog.migrate(second, { expectedFingerprint: approved.fingerprint, confirm: true })).rejects.toThrow(/drift/);
    const { execFile } = await import('node:child_process');
    const pid = await new Promise<number>((resolve, reject) => execFile(process.execPath, ['-e', 'console.log(process.pid)'], (error, stdout) => error ? reject(error) : resolve(Number(stdout.trim()))));
    const lease = `${first}.lease-stopped`; await fs.writeFile(lease, JSON.stringify({ pid, host: os.hostname() }));
    const ownership = await AssetCatalog.planMigration(first);
    expect(ownership.leaseEvidence).toMatchObject([{ path: lease, state: 'dead', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    await fs.writeFile(lease, JSON.stringify({ pid, host: os.hostname(), changedOwnershipEvidence: true }));
    const changed = await AssetCatalog.planMigration(first);
    expect(changed.sourceFingerprint).toBe(ownership.sourceFingerprint);
    expect(changed.fingerprint).not.toBe(ownership.fingerprint);
    await expect(AssetCatalog.recoverLeases(first, { expectedFingerprint: ownership.fingerprint, confirm: true })).rejects.toThrow(/drift/);
    await expect(AssetCatalog.migrate(first, { expectedFingerprint: ownership.fingerprint, confirm: true })).rejects.toThrow(/drift/);
    expect((await AssetCatalog.recoverLeases(first, { expectedFingerprint: changed.fingerprint, confirm: true })).recovered).toHaveLength(1);
  });
  it('refuses unsupported SQLite backup runtimes clearly before migration publication', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const plan = await AssetCatalog.planMigration(file), original = await fs.readFile(file);
    vi.doMock('node:sqlite', async () => ({ ...(await vi.importActual<typeof import('node:sqlite')>('node:sqlite')), backup: undefined }));
    try {
      await expect(AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: true })).rejects.toThrow(/runtime providing node:sqlite.backup/);
      expect(await fs.readFile(file)).toEqual(original);
      expect((await fs.readdir(root)).some(name => name.includes('.migrate-') || name.includes('.backup-'))).toBe(false);
    } finally { vi.doUnmock('node:sqlite'); }
  });
  it('bounds lease owner bytes before allocating or reading owner payloads', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const lease = `${file}.lease-oversized`; await fs.writeFile(lease, 'x'.repeat(4097));
    const realOpen = fs.open.bind(fs); let ownerBytesRead = 0;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]) === lease) {
        const realRead = handle.read.bind(handle);
        // Count attempted payload reads; an oversized stat must refuse beforehand.
        handle.read = (async (...readArgs: Parameters<typeof handle.read>) => { ownerBytesRead++; return realRead(...readArgs); }) as typeof handle.read;
      }
      return handle;
    });
    try {
      const plan = await AssetCatalog.planMigration(file);
      expect(plan.activeHandles).toEqual([lease]); expect(ownerBytesRead).toBe(0);
      expect(plan.leaseEvidence[0]?.sha256).toBeNull();
    } finally { spy.mockRestore(); }
  });
  it('requires explicit proven-dead lease recovery and refuses live or unknown ownership', async () => {
    const root = await workspace(), file = path.join(root, 'catalog.sqlite'); createV1(file);
    const lease = `${file}.lease-dead`, { execFile } = await import('node:child_process');
    const pid = await new Promise<number>((resolve, reject) => execFile(process.execPath, ['-e', 'console.log(process.pid)'], (error, stdout) => error ? reject(error) : resolve(Number(stdout.trim()))));
    await fs.writeFile(lease, JSON.stringify({ pid, host: os.hostname() }));
    const plan = await AssetCatalog.planMigration(file); expect(plan.deadHandles).toEqual([lease]);
    await expect(AssetCatalog.migrate(file, { expectedFingerprint: plan.fingerprint, confirm: true })).rejects.toThrow(/recover dead/);
    await expect(AssetCatalog.recoverLeases(file, { confirm: false })).rejects.toThrow();
    expect((await AssetCatalog.recoverLeases(file, { confirm: true })).recovered).toEqual([`${lease}.recovered`]);
    await fs.writeFile(`${file}.lease-unknown`, JSON.stringify({ pid, host: 'another-host' }));
    await expect(AssetCatalog.recoverLeases(file, { confirm: true })).rejects.toThrow(/unknown/);
  });
});
