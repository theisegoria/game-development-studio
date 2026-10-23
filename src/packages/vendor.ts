import { randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { sha256, writeJsonAtomic } from '../storage/filesystem.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { readAssetPackage, type AssetPackageManifest } from './format.js';
import { readPackage, packagePrimaryArtifact } from './reader.js';
import type { GeneralizedPackageManifest } from './format-v2.js';
import { SourceLedger, redistributionAssessment, type SourceInventory } from '../provenance/ledger.js';
import { withTransaction } from '../storage/transaction.js';
import { z } from 'zod';

export const VENDOR_LOCK_SCHEMA = 'game_dev.vendor_lock.v1';
export const VENDOR_RECEIPT_SCHEMA = 'game_dev.vendor_receipt.v1';

export interface VendorLockEntry {
  packageId: string;
  assetId: string;
  version: string;
  destination: string;
  modelSha256: string;
  manifestSha256: string;
  license: string;
  admittedAt: string;
}

export interface VendorLockEntryV2 {
  schema: 'game_dev.vendor_entry.v2'; packageId: string; assetId: string; version: string;
  destination: string; kind: GeneralizedPackageManifest['kind']; primary: { path: string; bytes: number; sha256: string };
  manifestSha256: string; license: string; admittedAt: string;
  sourceReferences: { sourceId: string; recordSha256: string; outputRights: string }[];
}
export interface VendorLock {
  schema: typeof VENDOR_LOCK_SCHEMA | 'game_dev.vendor_lock.v2';
  entries: (VendorLockEntry | VendorLockEntryV2)[];
}

export interface VendorAdmissionOptions {
  packagePath: string;
  projectRoot: string;
  destinationRelative?: string;
  confirm?: boolean;
  allowUnknownLicense?: boolean;
  allowInvalid?: boolean;
  clock?: () => Date;
  /** Trusted context location; never a client-supplied authority field. */
  sourceLedgerDirectory?: string;
  expectedFingerprint?: string;
}

export interface VendorAdmissionResult {
  dryRun: boolean;
  reused: boolean;
  packageId: string;
  projectRoot: string;
  destination: string;
  lockPath: string;
  receiptPath?: string;
  blockers: string[];
  plan?: VendorPlanV2;
  evidence: {
    packageHashesVerified: boolean;
    copiedPackageHashesVerified: boolean;
    projectImportTestPerformed: boolean;
    gpuRenderTestPerformed: boolean;
  };
}

function safeDestination(projectRoot: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/).some((segment) => segment === '..')) {
    throw invalidInput('vendor destination must be a relative path inside the project');
  }
  const target = path.resolve(projectRoot, relative);
  const rel = path.relative(projectRoot, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw invalidInput('vendor destination must identify a child directory inside the project');
  }
  return target;
}

async function rejectSymlinks(root: string): Promise<void> {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++visited > 10000) throw invalidState('Package entry traversal limit exceeded');
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw invalidState(`asset package contains a symbolic link: ${target}`);
      if (entry.isDirectory()) pending.push(target);
    }
  }
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const entryFields = { packageId: z.string().max(200), assetId: z.string().max(200), version: z.string().max(100), destination: z.string().min(1).max(4096), manifestSha256: digestSchema, license: z.string().max(128), admittedAt: z.string().datetime() };
const lockEntrySchema = z.union([
  z.object({ ...entryFields, modelSha256: digestSchema }).strict(),
  z.object({ ...entryFields, schema: z.literal('game_dev.vendor_entry.v2'), kind: z.enum(['mesh', 'animation', 'material', 'audio', 'flipbook']), primary: z.object({ path: z.string().max(240), bytes: z.number().int().positive(), sha256: digestSchema }).strict(), sourceReferences: z.array(z.object({ sourceId: z.string().max(120), recordSha256: digestSchema, outputRights: z.string().max(100) }).strict()).max(2080) }).strict(),
]);
async function readLock(lockPath: string): Promise<VendorLock> {
  try {
    const info = await fs.lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw invalidState('Vendor lock must be a bounded regular single-link file');
    const handle = await fs.open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.nlink !== 1 || opened.size !== info.size) throw invalidState('Vendor lock changed during reading');
      const bytes = Buffer.alloc(info.size + 1); const result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead !== info.size) throw invalidState('Vendor lock changed during reading');
      const parsed = z.object({ schema: z.enum(['game_dev.vendor_lock.v1', 'game_dev.vendor_lock.v2']), entries: z.array(lockEntrySchema).max(10000) }).strict().parse(JSON.parse(bytes.subarray(0, result.bytesRead).toString()));
      if (new Set(parsed.entries.map(entry => entry.destination)).size !== parsed.entries.length || (parsed.schema === VENDOR_LOCK_SCHEMA && parsed.entries.some(entry => 'schema' in entry))) throw invalidState('Invalid vendor lock entries');
      return parsed;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: VENDOR_LOCK_SCHEMA, entries: [] };
    throw error;
  }
}

function modelIdentity(manifest: AssetPackageManifest): { sha256: string } {
  const model = manifest.files.find((file) => file.kind === 'model');
  if (!model) throw invalidState(`package ${manifest.packageId} has no model entry`);
  return model;
}

async function admitLegacyVendorPackage(
  options: VendorAdmissionOptions,
): Promise<VendorAdmissionResult> {
  const packagePath = await fs.realpath(path.resolve(options.packagePath));
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot));
  if (!(await fs.stat(projectRoot)).isDirectory()) throw invalidInput('project root must be a directory');
  await rejectSymlinks(packagePath);
  const manifest = await readAssetPackage(packagePath);
  const destinationRelative = options.destinationRelative
    ?? path.join('Assets', 'Vendored', manifest.assetId, manifest.version);
  const destination = safeDestination(projectRoot, destinationRelative);
  const gameDevDirectory = path.join(projectRoot, '.game-dev');
  const lockPath = path.join(gameDevDirectory, 'vendor-lock.json');
  const blockers: string[] = [];
  if (manifest.license.toLocaleLowerCase() === 'unknown' && !options.allowUnknownLicense) {
    blockers.push('license is unknown; provide provenance or use --allow-unknown-license with explicit confirmation');
  }
  if (!manifest.validation.passed && !options.allowInvalid) {
    blockers.push(
      `package validation has ${manifest.validation.errorCount} error(s); repair it or explicitly allow invalid admission`,
    );
  }

  let reused = false;
  try {
    const existing = await readAssetPackage(destination);
    if (existing.packageId !== manifest.packageId) {
      blockers.push(`destination already contains different package ${existing.packageId}`);
    } else {
      reused = true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      try {
        await fs.access(destination);
        blockers.push(`destination exists but is not the same verified package: ${destination}`);
      } catch {
        // Destination is absent, which is the normal admission case.
      }
    }
  }

  const base: Omit<VendorAdmissionResult, 'dryRun' | 'receiptPath'> = {
    reused,
    packageId: manifest.packageId,
    projectRoot,
    destination,
    lockPath,
    blockers,
    evidence: {
      packageHashesVerified: true,
      copiedPackageHashesVerified: reused,
      projectImportTestPerformed: false,
      gpuRenderTestPerformed: false,
    },
  };
  if (!options.confirm || blockers.length > 0) return { ...base, dryRun: true };

  const now = (options.clock ?? (() => new Date()))().toISOString();
  await fs.mkdir(gameDevDirectory, { recursive: true, mode: 0o700 });
  if (!reused) {
    const stage = path.join(gameDevDirectory, `.vendor-staging-${randomUUID()}`);
    try {
      await fs.cp(packagePath, stage, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
      const copied = await readAssetPackage(stage);
      if (copied.packageId !== manifest.packageId) throw invalidState('copied package identity changed');
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      try {
        await fs.rename(stage, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const raced = await readAssetPackage(destination);
        if (raced.packageId !== manifest.packageId) throw error;
      }
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }

  const verified = await readAssetPackage(destination);
  if (verified.packageId !== manifest.packageId) throw invalidState('vendored package identity mismatch');
  const lock = await readLock(lockPath);
  const manifestBytes = await fs.readFile(path.join(destination, 'manifest.json'));
  const model = modelIdentity(manifest);
  const entry: VendorLockEntry = {
    packageId: manifest.packageId,
    assetId: manifest.assetId,
    version: manifest.version,
    destination: path.relative(projectRoot, destination),
    modelSha256: model.sha256,
    manifestSha256: sha256(manifestBytes),
    license: manifest.license,
    admittedAt: now,
  };
  lock.entries = [
    ...lock.entries.filter((candidate) => candidate.destination !== entry.destination),
    entry,
  ].sort((left, right) => left.destination.localeCompare(right.destination));
  await writeJsonAtomic(lockPath, lock);

  const receiptsDirectory = path.join(gameDevDirectory, 'vendor-receipts');
  await fs.mkdir(receiptsDirectory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(
    receiptsDirectory,
    `${now.replace(/[:.]/g, '-')}-${manifest.assetId}-${randomUUID()}.json`,
  );
  await writeJsonAtomic(receiptPath, {
    schema: VENDOR_RECEIPT_SCHEMA,
    ...entry,
    sourcePackagePath: packagePath,
    projectRoot,
    evidence: {
      packageHashesVerified: true,
      copiedPackageHashesVerified: true,
      projectImportTestPerformed: false,
      gpuRenderTestPerformed: false,
    },
  });
  return {
    ...base,
    dryRun: false,
    reused,
    receiptPath,
    evidence: {
      ...base.evidence,
      copiedPackageHashesVerified: true,
    },
  };
}

export interface VendorPlanV2 {
  schema: 'game_dev.vendor_plan.v2'; fingerprint: string; manifestSha256: string;
  packagePath: string; projectRoot: string; destination: string;
  targetManifestSha256: string | null;
  sourceReferences: VendorLockEntryV2['sourceReferences'];
  allowUnknownLicense: boolean; allowInvalid: boolean;
}
async function safeParents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw invalidInput('Vendor path leaves the project');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState('Vendor path contains symlink or non-directory'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
async function manifestHash(directory: string): Promise<string> {
  const file = path.join(directory, 'manifest.json'); const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw invalidState('Invalid package manifest');
  return sha256(await fs.readFile(file));
}
async function planV2(options: VendorAdmissionOptions, manifest: GeneralizedPackageManifest, packagePath: string, projectRoot: string) {
  const destination = safeDestination(projectRoot, options.destinationRelative ?? path.join('Assets', 'Vendored', manifest.assetId, manifest.version));
  const lockPath = path.join(projectRoot, '.game-dev', 'vendor-lock.json');
  await safeParents(projectRoot, destination); await safeParents(projectRoot, path.dirname(lockPath));
  const blockers: string[] = [];
  const refs = [...manifest.provenance.references, ...manifest.artifacts.flatMap(artifact => artifact.provenanceRefs)];
  const unique = [...new Map(refs.map(ref => [`${ref.sourceId}:${ref.recordSha256}`, ref])).values()].sort((a, b) => `${a.sourceId}:${a.recordSha256}`.localeCompare(`${b.sourceId}:${b.recordSha256}`));
  let inventory: SourceInventory | undefined;
  if (options.sourceLedgerDirectory) inventory = await (await SourceLedger.open(options.sourceLedgerDirectory)).inventory();
  const sourceReferences = unique.map(ref => {
    const current = inventory?.records.find(item => item.record.id === ref.sourceId);
    const found = current?.sha256 === ref.recordSha256 ? current : undefined;
    const outputRights = current && redistributionAssessment(current.record, 'output').status === 'denied' ? 'denied' : found ? redistributionAssessment(found.record, 'output').status : 'missing';
    if (outputRights === 'denied') blockers.push(`source ${ref.sourceId} denies output redistribution`);
    else if (outputRights !== 'documented_declaration' && !options.allowUnknownLicense) blockers.push(`source ${ref.sourceId} has ${outputRights} output rights`);
    return { ...ref, outputRights };
  });
  if (manifest.artifacts.some(artifact => artifact.provenanceRefs.length === 0 && manifest.provenance.references.length === 0) && !options.allowUnknownLicense) blockers.push('every shipped artifact requires bound output-rights provenance');
  if (manifest.license.toLowerCase() === 'unknown' && !options.allowUnknownLicense) blockers.push('license is unknown; documented output-rights references do not replace package license provenance');
  const primaryCheck = manifest.validation.kindChecks.find(check => check.artifact === manifest.primary);
  if ((!primaryCheck || primaryCheck.passed !== true || manifest.validation.kindChecks.some(check => check.passed === false)) && !options.allowInvalid) blockers.push('package kind validation failed or is not performed; semantic quality is unverified');
  let reused = false; let targetManifestSha256: string | null = null;
  try {
    const targetInfo = await fs.lstat(destination);
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw invalidState('Destination is not a real package directory');
    targetManifestSha256 = await manifestHash(destination);
    const existing = await readPackage(destination);
    if (existing.packageId !== manifest.packageId || targetManifestSha256 !== await manifestHash(packagePath)) blockers.push('destination contains different verified package');
    else reused = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // An existing incomplete destination must never be mistaken for an absent target.
    try { await fs.lstat(destination); blockers.push('destination exists without a verified manifest'); } catch (nested) { if ((nested as NodeJS.ErrnoException).code !== 'ENOENT') throw nested; }
  }
  const binding = { schema: 'game_dev.vendor_plan.v2' as const, manifestSha256: await manifestHash(packagePath), packagePath, projectRoot, destination, targetManifestSha256, sourceReferences, allowUnknownLicense: options.allowUnknownLicense === true, allowInvalid: options.allowInvalid === true };
  const plan = { ...binding, fingerprint: sha256(Buffer.from(JSON.stringify(binding))) };
  return { plan, blockers, reused, lockPath };
}

async function admissionDirectory(input: string): Promise<string> {
  let resolved = path.resolve(input);
  if (process.platform === 'darwin') {
    if (resolved === '/tmp' || resolved.startsWith('/tmp/')) resolved = `/private${resolved}`;
    if (resolved === '/var' || resolved.startsWith('/var/')) resolved = `/private${resolved}`;
  }
  await safeParents(path.parse(resolved).root, resolved);
  return fs.realpath(resolved);
}

export async function admitVendorPackage(options: VendorAdmissionOptions): Promise<VendorAdmissionResult> {
  const packagePath = await admissionDirectory(options.packagePath);
  const projectRoot = await admissionDirectory(options.projectRoot);
  if (!(await fs.stat(projectRoot)).isDirectory()) throw invalidInput('project root must be a directory');
  await rejectSymlinks(packagePath);
  const manifest = await readPackage(packagePath);
  if (manifest.schema === 'game_dev.asset_package.v1') {
    if (!options.confirm) return admitLegacyVendorPackage(options);
    await safeParents(projectRoot, safeDestination(projectRoot, options.destinationRelative ?? path.join('Assets', 'Vendored', manifest.assetId, manifest.version)));
    const directory = path.join(projectRoot, '.game-dev'); await safeParents(projectRoot, directory); await safeParents(projectRoot, path.join(directory, 'vendor-receipts')); await fs.mkdir(directory, { recursive: true });
    return withTransaction(path.join(directory, 'vendor-lock.json'), async () => { await readLock(path.join(directory, 'vendor-lock.json')); return admitLegacyVendorPackage(options); });
  }
  const prepared = await planV2(options, manifest, packagePath, projectRoot);
  const base: VendorAdmissionResult = { dryRun: true, reused: prepared.reused, packageId: manifest.packageId, projectRoot, destination: prepared.plan.destination, lockPath: prepared.lockPath, blockers: prepared.blockers, plan: prepared.plan,
    evidence: { packageHashesVerified: true, copiedPackageHashesVerified: prepared.reused, projectImportTestPerformed: false, gpuRenderTestPerformed: false } };
  if (!options.confirm || prepared.blockers.length) return base;
  if (options.expectedFingerprint !== prepared.plan.fingerprint) throw invalidState('V2 vendoring requires the unchanged reviewed plan fingerprint');
  const gameDevDirectory = path.dirname(prepared.lockPath); await fs.mkdir(gameDevDirectory, { recursive: true });
  return withTransaction(prepared.lockPath, async () => {
    const fresh = await planV2(options, await readPackage(packagePath) as GeneralizedPackageManifest, packagePath, projectRoot);
    if (fresh.plan.fingerprint !== options.expectedFingerprint || fresh.blockers.length) throw invalidState('Vendor source, rights or destination changed after planning');
    const lock = await readLock(prepared.lockPath);
    const now = (options.clock ?? (() => new Date()))().toISOString();
    const stage = path.join(gameDevDirectory, `.vendor-staging-${randomUUID()}`);
    try {
      if (!fresh.reused) {
        await fs.cp(packagePath, stage, { recursive: true, errorOnExist: true, force: false, dereference: false });
        await rejectSymlinks(stage); const copied = await readPackage(stage);
        if (copied.packageId !== manifest.packageId || await manifestHash(stage) !== fresh.plan.manifestSha256) throw invalidState('Copied package differs from approved source');
        const currentSource = await readPackage(packagePath);
        if (currentSource.schema !== 'game_dev.asset_package.v2') throw invalidState('Source package version changed');
        const rechecked = await planV2(options, currentSource, packagePath, projectRoot);
        if (rechecked.plan.fingerprint !== options.expectedFingerprint || rechecked.blockers.length) throw invalidState('Source, rights or destination drifted during copying');
        await safeParents(projectRoot, path.dirname(base.destination)); await fs.mkdir(path.dirname(base.destination), { recursive: true });
        try { await fs.lstat(base.destination); throw invalidState('Destination appeared during admission'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await fs.rename(stage, base.destination);
      }
      const verified = await readPackage(base.destination);
      if (verified.packageId !== manifest.packageId || await manifestHash(base.destination) !== fresh.plan.manifestSha256) throw invalidState('Vendored package differs from approved source');
      const entry: VendorLockEntryV2 = { schema: 'game_dev.vendor_entry.v2', packageId: manifest.packageId, assetId: manifest.assetId, version: manifest.version, destination: path.relative(projectRoot, base.destination), kind: manifest.kind, primary: packagePrimaryArtifact(manifest), manifestSha256: fresh.plan.manifestSha256, license: manifest.license, admittedAt: now, sourceReferences: fresh.plan.sourceReferences };
      const receiptsDirectory = path.join(gameDevDirectory, 'vendor-receipts'); await safeParents(projectRoot, receiptsDirectory); await fs.mkdir(receiptsDirectory, { recursive: true });
      const receiptPath = path.join(receiptsDirectory, `${now.replace(/[:.]/g, '-')}-${manifest.assetId}-${randomUUID()}.json`);
      await writeJsonAtomic(receiptPath, { ...entry, schema: 'game_dev.vendor_receipt.v2', sourcePackagePath: packagePath, projectRoot, planFingerprint: fresh.plan.fingerprint, evidence: { ...base.evidence, copiedPackageHashesVerified: true } });
      lock.schema = 'game_dev.vendor_lock.v2'; lock.entries = [...lock.entries.filter(candidate => candidate.destination !== entry.destination), entry].sort((a, b) => a.destination.localeCompare(b.destination));
      await writeJsonAtomic(prepared.lockPath, lock);
      return { ...base, dryRun: false, reused: fresh.reused, receiptPath, evidence: { ...base.evidence, copiedPackageHashesVerified: true } };
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  });
}
