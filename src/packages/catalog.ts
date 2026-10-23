import { randomUUID } from 'node:crypto';
import { promises as fs, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../storage/filesystem.js';
import { invalidInput, invalidState, notFound } from '../util/errors.js';
import { canonicalJson } from './format.js';
import { readPackage, packagePrimaryArtifact, type PackageManifest } from './reader.js';
import { atomicJson, withTransaction } from '../storage/transaction.js';

export const CATALOG_SCHEMA = 'game_dev.catalog.v1';
export const CATALOG_SCHEMA_V2 = 'game_dev.catalog.v2';
const DATABASE_VERSION = 2;

async function openDatabase(databasePath: string): Promise<DatabaseSync> {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(databasePath);
}

export interface CatalogAsset {
  packageId: string;
  assetId: string;
  version: string;
  displayName: string;
  description?: string;
  category?: string;
  license: string;
  packagePath: string;
  modelPath?: string;
  kind?: 'mesh' | 'animation' | 'material' | 'audio' | 'flipbook';
  primaryPath?: string;
  primarySha256?: string;
  previewPath?: string;
  modelSha256?: string;
  manifestSha256: string;
  validationPassed: boolean;
  validationErrors: number;
  validationWarnings: number;
  origin: string;
  provider?: string;
  indexedAt: string;
}

export interface CatalogListOptions {
  query?: string;
  category?: string;
  validationPassed?: boolean;
  limit?: number;
}

function createSchema(database: DatabaseSync, journalMode: 'WAL' | 'DELETE' = 'WAL'): void {
  database.exec(`
    PRAGMA journal_mode = ${journalMode};
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS assets (
      package_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      version TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      license TEXT NOT NULL,
      package_path TEXT NOT NULL UNIQUE,
      model_path TEXT,
      preview_path TEXT,
      model_sha256 TEXT,
      manifest_sha256 TEXT NOT NULL,
      validation_passed INTEGER NOT NULL CHECK (validation_passed IN (0, 1)),
      validation_errors INTEGER NOT NULL,
      validation_warnings INTEGER NOT NULL,
      origin TEXT NOT NULL,
      provider TEXT,
      indexed_at TEXT NOT NULL,
      search_text TEXT NOT NULL,
      kind TEXT NOT NULL,
      primary_path TEXT NOT NULL,
      primary_sha256 TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS assets_asset_id ON assets(asset_id);
    CREATE INDEX IF NOT EXISTS assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS assets_validation ON assets(validation_passed);
  `);
  database.prepare(
    'INSERT OR REPLACE INTO catalog_meta(key, value) VALUES (?, ?)',
  ).run('schema', CATALOG_SCHEMA_V2);
  database.prepare(
    'INSERT OR REPLACE INTO catalog_meta(key, value) VALUES (?, ?)',
  ).run('database_version', String(DATABASE_VERSION));
}

function rowToAsset(row: Record<string, unknown>): CatalogAsset {
  return {
    packageId: String(row.package_id),
    assetId: String(row.asset_id),
    version: String(row.version),
    displayName: String(row.display_name),
    ...(row.description !== null ? { description: String(row.description) } : {}),
    ...(row.category !== null ? { category: String(row.category) } : {}),
    license: String(row.license),
    packagePath: String(row.package_path),
    ...(row.model_path != null ? { modelPath: String(row.model_path) } : {}),
    ...(row.model_path == null ? { kind: row.kind as CatalogAsset['kind'], primaryPath: String(row.primary_path), primarySha256: String(row.primary_sha256) } : {}),
    ...(row.preview_path !== null ? { previewPath: String(row.preview_path) } : {}),
    ...(row.model_sha256 != null ? { modelSha256: String(row.model_sha256) } : {}),
    manifestSha256: String(row.manifest_sha256),
    validationPassed: Number(row.validation_passed) === 1,
    validationErrors: Number(row.validation_errors),
    validationWarnings: Number(row.validation_warnings),
    origin: String(row.origin),
    ...(row.provider !== null ? { provider: String(row.provider) } : {}),
    indexedAt: String(row.indexed_at),
  };
}

async function catalogRecord(
  packagePath: string,
  manifest?: PackageManifest,
): Promise<CatalogAsset> {
  const resolved = await fs.realpath(path.resolve(packagePath));
  const checked = manifest ?? await readPackage(resolved);
  const manifestBytes = await fs.readFile(path.join(resolved, 'manifest.json'));
  const primary = packagePrimaryArtifact(checked);
  const legacy = checked.schema === 'game_dev.asset_package.v1';
  const generalizedChecks = !legacy ? checked.validation.kindChecks : [];
  const preview = legacy ? checked.preview : checked.artifacts.find(file => file.role === 'preview')?.path;
  return {
    packageId: checked.packageId,
    assetId: checked.assetId,
    version: checked.version,
    displayName: legacy ? checked.displayName : checked.name,
    ...(checked.description ? { description: checked.description } : {}),
    ...(legacy && checked.category ? { category: checked.category } : {}),
    license: checked.license,
    packagePath: resolved,
    ...(legacy ? { modelPath: path.join(resolved, checked.model), modelSha256: primary.sha256 } : { kind: checked.kind, primaryPath: path.join(resolved, checked.primary), primarySha256: primary.sha256 }),
    ...(preview ? { previewPath: path.join(resolved, preview) } : {}),
    manifestSha256: sha256(manifestBytes),
    validationPassed: legacy ? checked.validation.passed : generalizedChecks.every(check => check.passed === true),
    validationErrors: legacy ? checked.validation.errorCount : generalizedChecks.filter(check => check.passed === false).length,
    validationWarnings: legacy ? checked.validation.warningCount : generalizedChecks.reduce((count, check) => count + check.warnings.length, 0),
    origin: checked.provenance.origin,
    ...(legacy && checked.provenance.provider ? { provider: checked.provenance.provider } : {}),
    indexedAt: new Date().toISOString(),
  };
}

function insert(database: DatabaseSync, asset: CatalogAsset, version = 2): void {
  if (version === 1 && !asset.modelPath) throw invalidState('Catalog v1 requires an explicit v2 migration before generalized package admission');
  const searchText = [
    asset.assetId,
    asset.displayName,
    asset.description,
    asset.category,
    asset.provider,
    asset.license,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
  database.prepare(`
    INSERT INTO assets (
      package_id, asset_id, version, display_name, description, category, license,
      package_path, model_path, preview_path, model_sha256, manifest_sha256,
      validation_passed, validation_errors, validation_warnings, origin, provider,
      indexed_at, search_text${version === 2 ? ', kind, primary_path, primary_sha256' : ''}
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${version === 2 ? ', ?, ?, ?' : ''})
    ON CONFLICT(package_id) DO UPDATE SET
      asset_id = excluded.asset_id,
      version = excluded.version,
      display_name = excluded.display_name,
      description = excluded.description,
      category = excluded.category,
      license = excluded.license,
      package_path = excluded.package_path,
      model_path = excluded.model_path,
      preview_path = excluded.preview_path,
      model_sha256 = excluded.model_sha256,
      manifest_sha256 = excluded.manifest_sha256,
      validation_passed = excluded.validation_passed,
      validation_errors = excluded.validation_errors,
      validation_warnings = excluded.validation_warnings,
      origin = excluded.origin,
      provider = excluded.provider,
      indexed_at = excluded.indexed_at,
      search_text = excluded.search_text${version === 2 ? ', kind = excluded.kind, primary_path = excluded.primary_path, primary_sha256 = excluded.primary_sha256' : ''}
  `).run(
    asset.packageId,
    asset.assetId,
    asset.version,
    asset.displayName,
    asset.description ?? null,
    asset.category ?? null,
    asset.license,
    asset.packagePath,
    asset.modelPath ?? null,
    asset.previewPath ?? null,
    asset.modelSha256 ?? null,
    asset.manifestSha256,
    asset.validationPassed ? 1 : 0,
    asset.validationErrors,
    asset.validationWarnings,
    asset.origin,
    asset.provider ?? null,
    asset.indexedAt,
    searchText,
    ...(version === 2 ? [asset.kind ?? 'mesh', asset.primaryPath ?? asset.modelPath!, asset.primarySha256 ?? asset.modelSha256!] : []),
  );
}

async function findPackages(root: string): Promise<string[]> {
  const resolved = path.resolve(root);
  const found: string[] = [];
  let assets: import('node:fs').Dirent[];
  try {
    assets = await fs.readdir(resolved, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  for (const asset of assets) {
    if (!asset.isDirectory() || asset.name.startsWith('.')) continue;
    const versions = await fs.readdir(path.join(resolved, asset.name), { withFileTypes: true });
    for (const version of versions) {
      if (!version.isDirectory() || version.name.startsWith('.')) continue;
      const packagePath = path.join(resolved, asset.name, version.name);
      try {
        await fs.access(path.join(packagePath, 'manifest.json'));
        found.push(packagePath);
      } catch {
        // Non-package directories are ignored; an invalid package with a
        // manifest is surfaced by readAssetPackage below.
      }
    }
  }
  return found.sort();
}

export interface CatalogMigrationPlan {
  schema: 'game_dev.catalog_migration_plan.v1'; databasePath: string;
  currentVersion: number; targetVersion: 2; needsMigration: boolean;
  sourceFingerprint: string; fingerprint: string; rows: number;
  activeHandles: string[]; deadHandles: string[]; leaseEvidence: CatalogLeaseEvidence[]; prerequisites: string[];
}
export interface CatalogLeaseEvidence { path: string; sha256: string | null; state: 'active' | 'dead' | 'unknown'; identity: string }
export interface CatalogRollbackPlan {
  schema: 'game_dev.catalog_rollback_plan.v1'; databasePath: string; backupPath: string;
  currentVersion: number; targetVersion: number; expectedFingerprint: string;
  sourceFingerprint: string; backupSha256: string; rows: number; prerequisites: string[];
}
export interface CatalogReplacementResult { databasePath: string; backupPath: string; receiptPath: string; fingerprint: string }
const CATALOG_LIMITS = { bytes: 64 * 1024 * 1024, rows: 10000, directoryEntries: 10000 };
const prerequisites = ['Close all catalog handles before replacing the index.', 'Stop external/unmanaged SQLite clients and other workspace writers; portable checks are not a security sandbox.', 'Only derived indexes change; sealed package bytes remain untouched.'];
function databaseVersion(database: DatabaseSync): number {
  const values = database.prepare('SELECT key, value FROM catalog_meta').all() as Record<string, unknown>[];
  const version = values.find(item => item.key === 'database_version')?.value;
  const schema = values.find(item => item.key === 'schema')?.value;
  if (version === '1' && schema === CATALOG_SCHEMA) return 1;
  if (version === '2' && schema === CATALOG_SCHEMA_V2) return 2;
  throw invalidState('Unsupported or corrupt catalog schema/version; refusing to stamp or downgrade the database');
}
async function boundedFile(file: string, maximum = CATALOG_LIMITS.bytes): Promise<Buffer> {
  const { constants } = await import('node:fs');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw invalidState('Unsafe or excessive catalog file');
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) { const next = await handle.read(bytes, count, bytes.length - count, count); if (!next.bytesRead) break; count += next.bytesRead; }
    if (count !== stat.size || (await handle.stat()).mtimeMs !== stat.mtimeMs) throw invalidState('Catalog file changed while reading');
    return bytes.subarray(0, count);
  } finally { await handle.close(); }
}
async function sourceFingerprint(file: string): Promise<string> {
  const files: { suffix: string; sha256: string | null }[] = [];
  for (const suffix of ['', '-wal']) {
    try { const bytes = await boundedFile(`${file}${suffix}`); files.push({ suffix, sha256: suffix && bytes.length === 0 ? null : sha256(bytes) }); }
    catch (error) { if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') files.push({ suffix, sha256: null }); else throw error; }
  }
  return sha256(Buffer.from(canonicalJson(files)));
}
async function snapshot(file: string): Promise<{ version: number; assets: CatalogAsset[]; fingerprint: string }> {
  const before = await sourceFingerprint(file);
  const { DatabaseSync: SQLite } = await import('node:sqlite');
  const database = new SQLite(file, { readOnly: true });
  try {
    database.exec('BEGIN');
    const version = databaseVersion(database);
    const rows = database.prepare('SELECT * FROM assets ORDER BY package_id LIMIT 10001').all() as Record<string, unknown>[];
    if (rows.length > CATALOG_LIMITS.rows) throw invalidState('Catalog migration exceeds 10000-row budget');
    const after = await sourceFingerprint(file);
    if (before !== after) throw invalidState('Catalog changed during snapshot; plan again');
    database.exec('ROLLBACK');
    return { version, assets: rows.map(rowToAsset), fingerprint: before };
  } finally { database.close(); }
}
async function trustedPath(file: string): Promise<string> {
  let current = path.dirname(path.resolve(file));
  const missing: string[] = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...missing.reverse(), path.basename(file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current)); current = parent;
    }
  }
}
async function leases(file: string): Promise<{ active: string[]; dead: string[]; evidence: CatalogLeaseEvidence[] }> {
  const active: string[] = [], dead: string[] = [], evidence: CatalogLeaseEvidence[] = [];
  const prefix = `${path.basename(file)}.lease-`, directory = await fs.opendir(path.dirname(file));
  let count = 0;
  for await (const entry of directory) {
    if (++count > CATALOG_LIMITS.directoryEntries) throw invalidState('Catalog lease inspection exceeds directory budget');
    if (!entry.name.startsWith(prefix) || entry.name.endsWith('.recovered')) continue;
    const target = path.join(path.dirname(file), entry.name);
    let bytesHash: string | null = null, identity = 'unreadable';
    try {
      const stat = await fs.lstat(target);
      identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.mode}`;
      const bytes = await boundedFile(target, 4096); bytesHash = sha256(bytes);
      const owner = JSON.parse(bytes.toString()) as { pid?: unknown; host?: unknown };
      if (owner?.host !== os.hostname() || !Number.isSafeInteger(owner?.pid) || Number(owner.pid) <= 0) {
        active.push(target); evidence.push({ path: target, sha256: bytesHash, identity, state: 'unknown' }); continue;
      }
      let state: CatalogLeaseEvidence['state'] = 'active';
      try { process.kill(Number(owner.pid), 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') state = 'dead'; }
      (state === 'dead' ? dead : active).push(target);
      evidence.push({ path: target, sha256: bytesHash, identity, state });
    } catch { active.push(target); evidence.push({ path: target, sha256: bytesHash, identity, state: 'unknown' }); }
  }
  active.sort(); dead.sort(); evidence.sort((a, b) => a.path.localeCompare(b.path));
  return { active, dead, evidence };
}
async function backupRuntime(): Promise<typeof import('node:sqlite')> {
  const sqlite = await import('node:sqlite');
  if (typeof sqlite.backup !== 'function') throw invalidState('Catalog migration/rollback requires a Node.js runtime providing node:sqlite.backup; upgrade the supported runtime before replacing a catalog');
  return sqlite;
}
async function requireClosed(file: string): Promise<void> {
  const found = await leases(file);
  if (found.active.length || found.dead.length) throw invalidState('Close live catalog handles and explicitly recover dead leases before replacement', found);
  await boundedFile(file);
  const database = await openDatabase(file);
  try { databaseVersion(database); database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK;'); }
  finally { database.close(); }
}
async function syncFile(file: string): Promise<void> { const handle = await fs.open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function syncParent(file: string): Promise<void> {
  const handle = await fs.open(path.dirname(file), 'r');
  try { await handle.sync(); } catch (error) { if (!['EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; } finally { await handle.close(); }
}
async function standaloneBackup(source: string, target: string): Promise<void> {
  const { DatabaseSync: SQLite, backup } = await backupRuntime();
  const database = new SQLite(source, { readOnly: true });
  try { await backup(database, target); } finally { database.close(); }
  const copied = await openDatabase(target);
  try { copied.exec('PRAGMA journal_mode=DELETE;'); databaseVersion(copied); } finally { copied.close(); }
  await syncFile(target);
}
async function replaceIndex(file: string, temporary: string, fingerprint: string, operation: string): Promise<CatalogReplacementResult> {
  if (await sourceFingerprint(file) !== fingerprint) throw invalidState('Catalog source drift; plan again');
  const backupPath = `${file}.backup-${randomUUID()}`;
  const receiptPath = `${backupPath}.migration.json`;
  await standaloneBackup(file, backupPath);
  if (await sourceFingerprint(file) !== fingerprint) throw invalidState('Catalog changed during backup; original preserved');
  const backupHash = sha256(await boundedFile(backupPath));
  const receipt = { schema: 'game_dev.catalog_replacement_receipt.v1', databasePath: file, backupPath, backupSha256: backupHash, sourceFingerprint: fingerprint, operation };
  await atomicJson(receiptPath, receipt);
  await syncFile(temporary);
  // Only empty WAL sidecars may be displaced: the main DB must already be
  // standalone, so a crash before rename leaves the old index readable.
  try { if ((await fs.stat(`${file}-wal`)).size !== 0) throw invalidState('Catalog still has WAL content; stop writers, checkpoint, and plan again'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const sidecars: { source: string; saved: string }[] = [];
  let replaced = false;
  try {
    for (const suffix of ['-wal', '-shm']) {
      const source = `${file}${suffix}`, saved = `${backupPath}.original${suffix}`;
      try { await fs.rename(source, saved); sidecars.push({ source, saved }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await fs.rename(temporary, file); // atomic main-file replacement, standalone backup already fsynced
    replaced = true;
    await syncParent(file);
  } catch (error) {
    if (!replaced) for (const sidecar of sidecars) await fs.rename(sidecar.saved, sidecar.source);
    throw error;
  }
  return { databasePath: file, backupPath, receiptPath, fingerprint: await sourceFingerprint(file) };
}

export class AssetCatalog {
  private constructor(
    readonly databasePath: string,
    private readonly database: DatabaseSync,
    readonly schemaVersion: number,
    private readonly leasePath: string,
  ) {}

  static async open(databasePath: string): Promise<AssetCatalog> {
    const resolved = path.resolve(databasePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
    return withTransaction(resolved, async () => {
      let exists = true;
      try { await fs.lstat(resolved); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
      if (exists) await boundedFile(resolved);
      const database = await openDatabase(resolved);
      const leasePath = `${resolved}.lease-${randomUUID()}`;
      try {
        if (!exists) createSchema(database);
        const version = databaseVersion(database);
        await atomicJson(leasePath, { pid: process.pid, host: os.hostname() });
        return new AssetCatalog(resolved, database, version, leasePath);
      } catch (error) { database.close(); throw error; }
    });
  }

  get supportsGeneralizedPackages(): boolean { return this.schemaVersion >= 2; }

  assertSupportsPackageSchema(schema: string): void {
    if (schema === 'game_dev.asset_package.v1') return;
    if (schema !== 'game_dev.asset_package.v2') throw invalidInput('Unsupported package schema');
    if (!this.supportsGeneralizedPackages) throw invalidState('CATALOG_MIGRATION_REQUIRED: inspect and confirm catalog v2 migration before generalized package writes');
  }

  close(): void {
    this.database.close();
    unlinkSync(this.leasePath);
  }

  /**
   * Build the row `admit` would insert, without inserting it.
   *
   * `admit` was the second write path in the CLI with no plan step at all, so
   * a caller had no way to see what indexing a package would record until it
   * was already recorded.
   */
  async planAdmission(packagePath: string): Promise<{ asset: CatalogAsset; alreadyIndexed: boolean }> {
    const asset = await catalogRecord(packagePath);
    if (!asset.modelPath) this.assertSupportsPackageSchema('game_dev.asset_package.v2');
    const row = this.database.prepare(
      'SELECT 1 FROM assets WHERE package_id = ?',
    ).get(asset.packageId) as unknown;
    return { asset, alreadyIndexed: row !== undefined };
  }

  async admit(packagePath: string): Promise<CatalogAsset> {
    const asset = await catalogRecord(packagePath);
    return withTransaction(this.databasePath, async () => { insert(this.database, asset, this.schemaVersion); return asset; });
  }

  get(packageId: string): CatalogAsset {
    const row = this.database.prepare(
      'SELECT * FROM assets WHERE package_id = ?',
    ).get(packageId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('catalog package', packageId);
    return rowToAsset(row);
  }

  list(options: CatalogListOptions = {}): CatalogAsset[] {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
      throw invalidInput('catalog limit must be an integer from 1 through 10000');
    }
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.query?.trim()) {
      clauses.push('search_text LIKE ? ESCAPE \'\\\'');
      const escaped = options.query.trim().toLocaleLowerCase().replace(/[\\%_]/g, '\\$&');
      parameters.push(`%${escaped}%`);
    }
    if (options.category) {
      clauses.push('category = ?');
      parameters.push(options.category);
    }
    if (options.validationPassed !== undefined) {
      clauses.push('validation_passed = ?');
      parameters.push(options.validationPassed ? 1 : 0);
    }
    parameters.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database.prepare(
      `SELECT * FROM assets ${where} ORDER BY display_name COLLATE NOCASE, version DESC LIMIT ?`,
    ).all(...parameters) as Record<string, unknown>[];
    return rows.map(rowToAsset);
  }

  static async planMigration(databasePath: string): Promise<CatalogMigrationPlan> {
    const resolved = path.resolve(databasePath);
    let current;
    try { current = await snapshot(resolved); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const found = current ? await leases(resolved) : { active: [], dead: [], evidence: [] };
    const contentFingerprint = current?.fingerprint ?? sha256(Buffer.from('absent'));
    const fingerprint = sha256(Buffer.from(canonicalJson({ schema: 'game_dev.catalog_migration_plan.v1', databasePath: await trustedPath(resolved),
      currentVersion: current?.version ?? 0, targetVersion: 2, sourceFingerprint: contentFingerprint,
      leaseEvidence: await Promise.all(found.evidence.map(async entry => ({ ...entry, path: await trustedPath(entry.path) }))) })));
    return { schema: 'game_dev.catalog_migration_plan.v1', databasePath: resolved, currentVersion: current?.version ?? 0, targetVersion: 2,
      needsMigration: current?.version === 1, sourceFingerprint: contentFingerprint, fingerprint, rows: current?.assets.length ?? 0,
      activeHandles: found.active, deadHandles: found.dead, leaseEvidence: found.evidence, prerequisites };
  }

  static async recoverLeases(databasePath: string, options: { confirm: boolean; expectedFingerprint?: string }): Promise<{ recovered: string[] }> {
    if (!options.confirm) throw invalidState('Dead catalog lease recovery requires explicit confirmation');
    const resolved = path.resolve(databasePath);
    return withTransaction(resolved, async () => {
      const reviewed = await this.planMigration(resolved);
      if (options.expectedFingerprint !== undefined && reviewed.fingerprint !== options.expectedFingerprint) throw invalidState('Catalog lease recovery plan drift');
      const found = await leases(resolved);
      if (found.active.length) throw invalidState('Live or unknown catalog ownership blocks lease recovery');
      const recovered: string[] = [];
      for (const lease of found.dead) {
        // Recheck under transaction; timestamps never establish owner death.
        const expected = found.evidence.find(entry => entry.path === lease);
        const fresh = (await leases(resolved)).evidence.find(entry => entry.path === lease);
        if (!fresh || fresh.state !== 'dead' || canonicalJson(fresh) !== canonicalJson(expected)) throw invalidState('Catalog lease ownership changed during recovery');
        await fs.rename(lease, `${lease}.recovered`); recovered.push(`${lease}.recovered`);
      }
      return { recovered };
    });
  }

  static async migrate(databasePath: string, options: { expectedFingerprint: string; confirm: boolean }): Promise<CatalogReplacementResult> {
    if (!options.confirm) throw invalidState('Catalog migration requires fresh explicit confirmation');
    const resolved = path.resolve(databasePath);
    return withTransaction(resolved, async () => {
      const reviewed = await this.planMigration(resolved);
      if (reviewed.currentVersion !== 1 || reviewed.fingerprint !== options.expectedFingerprint) throw invalidState('Catalog migration plan drift or unsupported source version');
      await requireClosed(resolved);
      const current = await snapshot(resolved);
      if (current.version !== 1 || current.fingerprint !== reviewed.sourceFingerprint) throw invalidState('Catalog migration plan drift or unsupported source version');
      await backupRuntime();
      const temporary = `${resolved}.migrate-${randomUUID()}`;
      try {
        const database = await openDatabase(temporary);
        try { createSchema(database, 'DELETE'); database.exec('BEGIN'); for (const asset of current.assets) insert(database, asset); database.exec('COMMIT'); }
        finally { database.close(); }
        return await replaceIndex(resolved, temporary, current.fingerprint, 'migration');
      } finally { await fs.rm(temporary, { force: true }); }
    });
  }

  static async planRollback(databasePath: string, backupPath: string): Promise<CatalogRollbackPlan> {
    const resolved = path.resolve(databasePath), backup = path.resolve(backupPath);
    if (path.dirname(backup) !== path.dirname(resolved) || !path.basename(backup).startsWith(`${path.basename(resolved)}.backup-`)) throw invalidInput('Rollback requires this catalog own replacement backup');
    const receipt = JSON.parse((await boundedFile(`${backup}.migration.json`)).toString()) as Record<string, unknown>;
    if (receipt.schema !== 'game_dev.catalog_replacement_receipt.v1' || receipt.databasePath !== resolved || receipt.backupPath !== backup || !['migration', 'rollback', 'rebuild'].includes(String(receipt.operation))) throw invalidState('Backup receipt is not bound to this catalog');
    const backupSha256 = sha256(await boundedFile(backup));
    if (receipt.backupSha256 !== backupSha256) throw invalidState('Catalog backup hash differs from its receipt');
    const current = await snapshot(resolved), previous = await snapshot(backup);
    const expectedFingerprint = sha256(Buffer.from(canonicalJson({ source: current.fingerprint, backupSha256, backup })));
    return { schema: 'game_dev.catalog_rollback_plan.v1', databasePath: resolved, backupPath: backup, currentVersion: current.version,
      targetVersion: previous.version, expectedFingerprint, sourceFingerprint: current.fingerprint, backupSha256, rows: previous.assets.length, prerequisites };
  }

  static async rollback(databasePath: string, backupPath: string, options: { expectedFingerprint: string; confirm: boolean }): Promise<CatalogReplacementResult> {
    if (!options.confirm) throw invalidState('Catalog rollback requires fresh explicit confirmation');
    const resolved = path.resolve(databasePath);
    return withTransaction(resolved, async () => {
      await requireClosed(resolved);
      const plan = await this.planRollback(resolved, backupPath);
      if (plan.expectedFingerprint !== options.expectedFingerprint) throw invalidState('Catalog rollback plan drift');
      await backupRuntime();
      const temporary = `${resolved}.rollback-${randomUUID()}`;
      try { await standaloneBackup(plan.backupPath, temporary); return await replaceIndex(resolved, temporary, plan.sourceFingerprint, 'rollback'); }
      finally { await fs.rm(temporary, { force: true }); }
    });
  }

  static async rebuild(databasePath: string, packagesRoot: string): Promise<{ indexed: CatalogAsset[]; databasePath: string; backupPath?: string }> {
    const resolved = path.resolve(databasePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
    return withTransaction(resolved, async () => {
      let current;
      try { await requireClosed(resolved); current = await snapshot(resolved); if (current.version === 1) throw invalidState('CATALOG_MIGRATION_REQUIRED: explicitly migrate v1 before rebuilding the generalized catalog'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const temporary = `${resolved}.rebuild-${randomUUID()}`, database = await openDatabase(temporary), indexed: CatalogAsset[] = [];
      try {
        createSchema(database, 'DELETE'); database.exec('BEGIN');
        for (const packagePath of await findPackages(packagesRoot)) { const asset = await catalogRecord(packagePath); insert(database, asset); indexed.push(asset); }
        database.exec('COMMIT');
      } catch (error) { database.close(); await fs.rm(temporary, { force: true }); throw error; }
      database.close();
      try {
        if (current) { const replacement = await replaceIndex(resolved, temporary, current.fingerprint, 'rebuild'); return { indexed, databasePath: resolved, backupPath: replacement.backupPath }; }
        await syncFile(temporary); await fs.rename(temporary, resolved); await syncParent(resolved);
        return { indexed, databasePath: resolved };
      } finally { await fs.rm(temporary, { force: true }); }
    });
  }
}
