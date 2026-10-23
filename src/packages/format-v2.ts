/** Additive generalized package core. Existing v1 format/catalog remain authoritative for v1. */
import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { z } from 'zod';
import { canonicalJson } from './format.js';
import { sanitizeAssetName } from '../domain/asset-spec.js';
import { inspectGltf } from '../inspection/gltf.js';
import { evaluateAsset } from '../domain/asset-policy.js';
import { readReviewDocument } from '../review/document.js';
import { withTransaction } from '../storage/transaction.js';
import { invalidInput, invalidState } from '../util/errors.js';

export const GENERALIZED_PACKAGE_LIMITS = { artifacts: 64, artifactBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, manifestBytes: 1024 * 1024 } as const;
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
export const packageKindSchema = z.enum(['mesh', 'animation', 'material', 'audio', 'flipbook']);
export const packageArtifactRoleSchema = z.enum(['mesh', 'animation', 'material', 'audio', 'flipbook', 'texture', 'editable-source', 'lod', 'collision', 'lod-chain', 'recipe', 'preview', 'metadata', 'provenance']);
const logicalPathSchema = z.string().min(1).max(240).refine(value => {
  const parts = value.split('/');
  return parts.length <= 6 && parts.every(part => /^[a-z0-9][a-z0-9._-]{0,79}$/.test(part) && !part.endsWith('.') && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/.test(part))
    && !['manifest.json', 'receipt.json'].includes(value);
}, 'Use portable lowercase relative artifact paths without traversal, aliases or reserved package names');
export const packageProvenanceReferenceSchema = z.object({ sourceId: idSchema, recordSha256: hashSchema }).strict();
const refsSchema = z.array(packageProvenanceReferenceSchema).max(32).default([]);
const artifactMetadata = {
  path: logicalPathSchema,
  role: packageArtifactRoleSchema,
  level: z.number().int().min(0).max(8).optional(),
  provenanceRefs: refsSchema,
};
const inputArtifact = z.object({ ...artifactMetadata, sourcePath: z.string().min(1).max(4096).refine(path.isAbsolute, 'Artifact sources must be absolute paths') }).strict();
const storedArtifact = z.object({ ...artifactMetadata, bytes: z.number().int().min(1).max(GENERALIZED_PACKAGE_LIMITS.artifactBytes), sha256: hashSchema }).strict();
const commonMetadata = {
  kind: packageKindSchema,
  name: z.string().trim().min(1).max(200),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/).max(100).default('1.0.0'),
  description: z.string().trim().max(4000).optional(),
  license: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z ._()+:/-]{0,127}$/).default('unknown'),
  primary: logicalPathSchema,
  provenance: z.object({ origin: z.enum(['authored', 'generated', 'imported', 'migrated']).default('authored'), references: refsSchema }).strict().default({}),
};
function checkArtifacts(value: { kind: string; primary: string; artifacts: { path: string; role: string; level?: number }[] }, ctx: z.RefinementCtx): void {
  const paths = new Set<string>();
  for (const artifact of value.artifacts) {
    if (paths.has(artifact.path)) ctx.addIssue({ code: 'custom', message: `Duplicate artifact path: ${artifact.path}` });
    paths.add(artifact.path);
    if ((artifact.role === 'lod') !== (artifact.level !== undefined)) ctx.addIssue({ code: 'custom', message: 'Only LOD artifacts require an explicit level' });
  }
  for (const logical of paths) for (const other of paths) {
    if (logical !== other && other.startsWith(`${logical}/`)) ctx.addIssue({ code: 'custom', message: 'Artifact paths cannot alias directories' });
  }
  const primary = value.artifacts.find(artifact => artifact.path === value.primary);
  if (!primary || primary.role !== value.kind) ctx.addIssue({ code: 'custom', message: 'Primary must reference an artifact whose role matches the package kind' });
  const levels = value.artifacts.filter(artifact => artifact.role === 'lod').map(artifact => artifact.level);
  if (new Set(levels).size !== levels.length) ctx.addIssue({ code: 'custom', message: 'LOD levels must be unique' });
}
export const generalizedPackageRequestSchema = z.object({
  schema: z.literal('game_dev.asset_package_request.v2').default('game_dev.asset_package_request.v2'),
  ...commonMetadata,
  artifacts: z.array(inputArtifact).min(1).max(GENERALIZED_PACKAGE_LIMITS.artifacts),
}).strict().superRefine(checkArtifacts);
const kindValidationSchema = z.object({
  artifact: logicalPathSchema,
  check: z.enum(['static-mesh-policy', 'static-animation-presence', 'declared-kind-only']),
  passed: z.boolean().nullable(),
  triangles: z.number().int().nonnegative().optional(),
  animationClips: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string().max(8000)).max(256),
}).strict();
const validationSchema = z.object({
  schema: z.literal('game_dev.asset_package_validation.v2'),
  integrity: z.literal('hash-verified'),
  kindChecks: z.array(kindValidationSchema).min(1).max(GENERALIZED_PACKAGE_LIMITS.artifacts),
  quality: z.literal('unverified'),
  engineImport: z.literal('not-performed'),
  humanReview: z.literal('not-performed'),
  provenanceRights: z.literal('declared-references-only'),
}).strict();
const manifestShape = {
  schema: z.literal('game_dev.asset_package.v2'),
  packageId: z.string().regex(/^pkg_[0-9a-f]{24}$/),
  assetId: z.string().min(1).max(200).regex(/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}_-]*$/u),
  ...commonMetadata,
  artifacts: z.array(storedArtifact).min(1).max(GENERALIZED_PACKAGE_LIMITS.artifacts),
  validation: validationSchema,
  implementation: z.object({
    id: z.literal('gds-generalized-package'), version: z.literal('1'), sha256: hashSchema,
    scope: z.literal('local-validator-files-and-package-entrypoints'), nodeVersion: z.string().max(100),
    files: z.array(z.object({ id: z.string().max(200), sha256: hashSchema }).strict()).max(32),
    libraries: z.array(z.object({ name: z.string().max(100), version: z.string().max(100), entrypointSha256: hashSchema, metadataSha256: hashSchema }).strict()).max(8),
    unboundDependencies: z.array(z.string().max(500)).max(8),
  }).strict(),
};
export const generalizedPackageManifestSchema = z.object(manifestShape).strict().superRefine((value, ctx) => {
  checkArtifacts(value, ctx);
  if (value.artifacts.reduce((sum, file) => sum + file.bytes, 0) > GENERALIZED_PACKAGE_LIMITS.totalBytes) ctx.addIssue({ code: 'custom', message: 'Package total byte budget exceeded' });
  if (value.validation.kindChecks.some(check => !value.artifacts.some(artifact => artifact.path === check.artifact))) ctx.addIssue({ code: 'custom', message: 'Validation references missing artifacts' });
});
export type GeneralizedPackageRequest = z.infer<typeof generalizedPackageRequestSchema>;
export type GeneralizedPackageManifest = z.infer<typeof generalizedPackageManifestSchema>;
export interface GeneralizedPackagePlan {
  schema: 'game_dev.asset_package_plan.v2';
  fingerprint: string;
  packagesRoot: string;
  destination: string;
  manifest: GeneralizedPackageManifest;
  sources: { path: string; sourcePath: string; bytes: number; sha256: string }[];
  limitations: string[];
}
export interface GeneralizedPackageResult {
  packagePath: string; manifestPath: string; receiptPath: string; manifestSha256: string;
  manifest: GeneralizedPackageManifest; reused: boolean;
}

async function boundedRead(file: string, maximum: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) throw invalidInput('Package input must be a nonempty bounded regular single-link file', { file, maximum });
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximum || total > stat.size) throw invalidState('Package file changed or exceeded its byte budget during reading');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total !== stat.size) throw invalidState('Package file changed during reading');
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}
async function canonicalRoot(root: string): Promise<string> {
  let existing = path.resolve(root);
  const missing: string[] = [];
  for (;;) {
    try {
      const stat = await fs.lstat(existing);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidInput('Package root must be a real directory');
      return path.join(await fs.realpath(existing), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.push(path.basename(existing)); existing = path.dirname(existing);
    }
  }
}
async function safeDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await safeDirectory(parent);
  try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState('Package directory contains a symlink or non-directory', { directory });
}
async function flushDirectory(directory: string): Promise<void> {
  try { const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && !(process.platform === 'win32' && ['EPERM', 'EISDIR'].includes(code ?? ''))) throw error;
  }
}
function packageIdentity(manifest: Omit<GeneralizedPackageManifest, 'packageId'>): string { return `pkg_${digest(canonicalJson(manifest)).slice(0, 24)}`; }
async function checkGlb(bytes: Uint8Array): Promise<void> {
  const parsed = await new NodeIO().binaryToJSON(bytes);
  if ((parsed.json.buffers ?? []).some(buffer => buffer.uri !== undefined) || (parsed.json.images ?? []).some(image => image.uri !== undefined)) throw invalidInput('Generalized packages require self-contained GLB resources without URIs');
  await readReviewDocument(bytes);
}

async function implementationIdentity(): Promise<GeneralizedPackageManifest['implementation']> {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const modules = ['packages/format-v2', 'packages/format', 'domain/asset-policy', 'domain/asset-spec', 'inspection/gltf', 'review/document', 'review/settings', 'production/ktx2', 'storage/transaction'];
  const files = [];
  for (const id of modules) files.push({ id, sha256: digest(await boundedRead(fileURLToPath(new URL(`../${id}${extension}`, import.meta.url)), GENERALIZED_PACKAGE_LIMITS.manifestBytes)) });
  const libraries = [];
  for (const name of ['@gltf-transform/core', '@gltf-transform/extensions', 'zod']) {
    const entrypoint = fileURLToPath(import.meta.resolve(name));
    let directory = path.dirname(entrypoint);
    for (;;) {
      try {
        const metadataBytes = await boundedRead(path.join(directory, 'package.json'), GENERALIZED_PACKAGE_LIMITS.manifestBytes);
        const metadata = JSON.parse(metadataBytes.toString()) as { name?: unknown; version?: unknown };
        if (metadata.name === name && typeof metadata.version === 'string') {
          libraries.push({ name, version: metadata.version, entrypointSha256: digest(await boundedRead(entrypoint, 16 * 1024 * 1024)), metadataSha256: digest(metadataBytes) });
          break;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(directory);
      if (parent === directory) throw invalidState('Cannot identify installed validation dependency', { name });
      directory = parent;
    }
  }
  const scope = 'local-validator-files-and-package-entrypoints' as const;
  const unboundDependencies = ['Transitive local/library code beyond the listed files and entrypoints is not a complete installed-byte closure.', 'Native runtime, filesystem and operating-system implementations are not byte-bound; Node version is recorded.'];
  const metadata = { files, libraries, scope, nodeVersion: process.version, unboundDependencies };
  return { id: 'gds-generalized-package', version: '1', sha256: digest(canonicalJson(metadata)), ...metadata };
}

/** Read-only: validates and hashes sources without creating a package or a directory. */
export async function planGeneralizedPackage(input: unknown, packagesRoot: string): Promise<GeneralizedPackagePlan> {
  const request = generalizedPackageRequestSchema.parse(input);
  const root = await canonicalRoot(packagesRoot);
  const sources: GeneralizedPackagePlan['sources'] = [];
  const files: GeneralizedPackageManifest['artifacts'] = [];
  const checks: GeneralizedPackageManifest['validation']['kindChecks'] = [];
  const physical = new Set<string>();
  let total = 0;
  for (const artifact of [...request.artifacts].sort((a, b) => a.path.localeCompare(b.path))) {
    const source = path.resolve(artifact.sourcePath);
    if ((await fs.lstat(source)).isSymbolicLink()) throw invalidInput('Package sources cannot be symbolic links');
    const canonical = await fs.realpath(source);
    if (physical.has(canonical)) throw invalidInput('Package artifacts must not alias the same source file');
    physical.add(canonical);
    const bytes = await boundedRead(canonical, GENERALIZED_PACKAGE_LIMITS.artifactBytes);
    total += bytes.length;
    if (total > GENERALIZED_PACKAGE_LIMITS.totalBytes) throw invalidInput('Package total byte budget exceeded');
    const { sourcePath: _sourcePath, ...metadata } = artifact;
    const identity = { bytes: bytes.length, sha256: digest(bytes) };
    sources.push({ path: artifact.path, sourcePath: canonical, ...identity }); files.push({ ...metadata, ...identity });
    if (['mesh', 'animation', 'lod', 'collision'].includes(artifact.role)) {
      if (path.extname(artifact.path) !== '.glb' || path.extname(canonical).toLowerCase() !== '.glb') throw invalidInput('Geometry artifacts must be self-contained GLB files');
      await checkGlb(bytes);
      const inspection = await inspectGltf(canonical);
      if (artifact.role === 'animation') {
        if (inspection.animationCount < 1) throw invalidInput('Animation artifact contains no animation clips');
        checks.push({ artifact: artifact.path, check: 'static-animation-presence', passed: true, animationClips: inspection.animationCount,
          warnings: ['Clip presence is established; rig compatibility, root motion, retargeting and animation quality are not validated.'] });
      } else {
        const report = evaluateAsset(inspection);
        if (!report.passed) throw invalidInput('Geometry artifact failed default static mesh policy', { artifact: artifact.path, report });
        checks.push({ artifact: artifact.path, check: 'static-mesh-policy', passed: true, triangles: inspection.triangleCount, warnings: report.inspectorWarnings });
      }
    } else if (artifact.path === request.primary) {
      checks.push({ artifact: artifact.path, check: 'declared-kind-only', passed: null,
        warnings: [`${request.kind} content is retained and hashed; format decoding, semantic validity and quality are not established.`] });
    }
    // Bind inspection to the same bytes that formed the content identity.
    if (digest(await boundedRead(canonical, GENERALIZED_PACKAGE_LIMITS.artifactBytes)) !== identity.sha256) throw invalidState('Package source changed during planning');
  }
  const identity = await implementationIdentity();
  const { schema: _schema, artifacts: _artifacts, ...metadata } = request;
  const body: Omit<GeneralizedPackageManifest, 'packageId'> = { schema: 'game_dev.asset_package.v2', ...metadata, assetId: sanitizeAssetName(request.name), artifacts: files,
    validation: { schema: 'game_dev.asset_package_validation.v2', integrity: 'hash-verified', kindChecks: checks, quality: 'unverified', engineImport: 'not-performed', humanReview: 'not-performed', provenanceRights: 'declared-references-only' }, implementation: identity };
  const manifest = generalizedPackageManifestSchema.parse({ ...body, packageId: packageIdentity(body) });
  if (Buffer.byteLength(canonicalJson(manifest)) > GENERALIZED_PACKAGE_LIMITS.manifestBytes) throw invalidInput('Package manifest byte budget exceeded');
  const destination = path.join(root, 'v2', manifest.packageId);
  const fingerprint = digest(canonicalJson({ manifest, sources, packagesRoot: root }));
  return { schema: 'game_dev.asset_package_plan.v2', fingerprint, packagesRoot: root, destination, manifest, sources,
    limitations: [...identity.unboundDependencies, 'Package hashes establish byte integrity, not authorship, legal clearance, artistic quality or engine admission.', 'Material, audio and flipbook kind declarations are not semantic/quality validation.', 'Preview artifacts are copied evidence; this packager does not produce or approve previews.'] };
}

const receiptSchema = z.object({ schema: z.literal('game_dev.package_receipt.v2'), packageId: z.string().regex(/^pkg_[a-f0-9]{24}$/), manifestSha256: hashSchema, plannedFingerprint: hashSchema }).strict();
async function writeFile(file: string, bytes: Uint8Array | string): Promise<void> {
  await safeDirectory(path.dirname(file));
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function listFiles(directory: string, expectedDirectories: ReadonlySet<string>): Promise<string[]> {
  const files: string[] = [];
  const pending = [{ directory, relative: '' }];
  let entries = 0;
  while (pending.length) {
    const next = pending.pop()!;
    for (const entry of await fs.readdir(next.directory, { withFileTypes: true })) {
      if (++entries > GENERALIZED_PACKAGE_LIMITS.artifacts * 7 + 2) throw invalidInput('Package directory traversal budget exceeded');
      const relative = next.relative ? `${next.relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw invalidState('Package contains a symbolic link');
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(relative)) throw invalidState('Package contains an unexpected directory');
        pending.push({ directory: path.join(next.directory, entry.name), relative });
      }
      else if (entry.isFile()) files.push(relative);
      else throw invalidState('Package contains a non-regular file');
    }
  }
  return files.sort();
}

/** Recomputes closure identity and every file digest. Does not rewrite sealed evidence. */
export async function readGeneralizedPackage(packagePath: string): Promise<GeneralizedPackageManifest> {
  const directory = path.resolve(packagePath);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidInput('Package must be a real directory');
  const manifestBytes = await boundedRead(path.join(directory, 'manifest.json'), GENERALIZED_PACKAGE_LIMITS.manifestBytes);
  const manifest = generalizedPackageManifestSchema.parse(JSON.parse(manifestBytes.toString()));
  const { packageId, ...identity } = manifest;
  if (packageIdentity(identity) !== packageId) throw invalidState('Generalized package identity does not match manifest closure');
  if (canonicalJson(manifest) !== manifestBytes.toString()) throw invalidState('Package manifest is not canonical');
  const directories = new Set<string>();
  for (const artifact of manifest.artifacts) {
    const parts = artifact.path.split('/');
    for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'));
  }
  const names = await listFiles(directory, directories);
  if (canonicalJson(names) !== canonicalJson([...manifest.artifacts.map(file => file.path), 'manifest.json', 'receipt.json'].sort())) throw invalidState('Package contains missing or unexpected files');
  for (const artifact of manifest.artifacts) {
    const bytes = await boundedRead(path.join(directory, artifact.path), artifact.bytes);
    if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) throw invalidState('Package artifact hash verification failed', { artifact: artifact.path });
  }
  const receipt = receiptSchema.parse(JSON.parse((await boundedRead(path.join(directory, 'receipt.json'), GENERALIZED_PACKAGE_LIMITS.manifestBytes)).toString()));
  if (receipt.packageId !== packageId || receipt.manifestSha256 !== digest(manifestBytes)) throw invalidState('Package receipt does not match manifest identity');
  return manifest;
}

/** Explicit approved fingerprint; destination is derived exclusively from the trusted root and closure ID. */
export async function buildGeneralizedPackage(input: unknown, packagesRoot: string, approvedFingerprint: string): Promise<GeneralizedPackageResult> {
  hashSchema.parse(approvedFingerprint);
  const plan = await planGeneralizedPackage(input, packagesRoot);
  if (plan.fingerprint !== approvedFingerprint) throw invalidState('Generalized package plan changed; review source identities and current destination again');
  const parent = path.dirname(plan.destination);
  await safeDirectory(parent);
  return withTransaction(plan.destination, async () => {
    await safeDirectory(parent);
    let exists = false;
    try { await fs.lstat(plan.destination); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const manifestText = canonicalJson(plan.manifest), manifestSha256 = digest(manifestText);
    const result = (reused: boolean): GeneralizedPackageResult => ({ packagePath: plan.destination, manifestPath: path.join(plan.destination, 'manifest.json'), receiptPath: path.join(plan.destination, 'receipt.json'), manifestSha256, manifest: plan.manifest, reused });
    if (exists) {
      const existing = await readGeneralizedPackage(plan.destination);
      if (canonicalJson(existing) !== manifestText) throw invalidState('Immutable package destination contains different metadata');
      return result(true);
    }
    const stage = await fs.mkdtemp(path.join(parent, '.v2-stage-'));
    try {
      for (const source of plan.sources) {
        const bytes = await boundedRead(source.sourcePath, GENERALIZED_PACKAGE_LIMITS.artifactBytes);
        if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw invalidState('Source drift while staging generalized package');
        await writeFile(path.join(stage, source.path), bytes);
      }
      await writeFile(path.join(stage, 'manifest.json'), manifestText);
      await writeFile(path.join(stage, 'receipt.json'), canonicalJson(receiptSchema.parse({ schema: 'game_dev.package_receipt.v2', packageId: plan.manifest.packageId, manifestSha256, plannedFingerprint: approvedFingerprint })));
      await readGeneralizedPackage(stage);
      if ((await planGeneralizedPackage(input, packagesRoot)).fingerprint !== approvedFingerprint) throw invalidState('Source, implementation or output drift before package publication');
      await safeDirectory(parent); await flushDirectory(stage);
      await fs.rename(stage, plan.destination); await flushDirectory(parent);
      return result(false);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  });
}
