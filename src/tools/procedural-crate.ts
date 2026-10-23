import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { generateProceduralCrate, proceduralCrateRecipeSchema, type ProceduralCrateRecipe } from '../production/procedural-crate.js';
import { inspectGltf } from '../inspection/gltf.js';
import { evaluateAsset } from '../domain/asset-policy.js';
import { previewGlb } from '../review/previews.js';
import { REVIEW_RENDERER } from '../review/settings.js';
import { generalizedPackageRequestSchema, packageProvenanceReferenceSchema } from '../packages/format-v2.js';
import { withTransaction } from '../storage/transaction.js';
import { invalidState } from '../util/errors.js';
import { guard, ok, type ToolContext, type VisualAttachment } from './context.js';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const previewSettings = { mode: 'appearance', resolution: 128, decodeBasisTextures: false } as const;
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const proceduralCratePackageMetadataSchema = z.object({
  name: z.string().trim().min(1).max(200).default('Procedural crate'),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/).max(100).default('1.0.0'),
  license: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z ._()+:/-]{0,127}$/).default('unknown'),
  description: z.string().trim().max(4000).optional(),
  provenance: z.object({ origin: z.enum(['authored', 'generated', 'imported', 'migrated']).default('generated'), references: z.array(packageProvenanceReferenceSchema).max(32).default([]) }).strict().default({}),
}).strict();
type PackageMetadata = z.infer<typeof proceduralCratePackageMetadataSchema>;
const planInput = z.object({ recipe: proceduralCrateRecipeSchema, packageMetadata: proceduralCratePackageMetadataSchema.default({}) }).strict();
const constructInput = planInput.extend({ approvedFingerprint: fingerprintSchema }).strict();

async function readRegular(file: string, maximum = 2_000_000): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw invalidState('Crate artifact is not a bounded regular single-link file', { file });
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum || total > stat.size) throw invalidState('Crate artifact changed or exceeded its byte budget during reading', { file });
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total !== stat.size) throw invalidState('Crate artifact changed during reading', { file });
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

/** Resolve a not-yet-created configured output without writing during planning. */
async function canonicalOutput(configured: string): Promise<string> {
  let candidate = path.resolve(configured);
  const missing: string[] = [];
  for (;;) {
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState('Configured crate output must be a real directory');
      return path.join(await fs.realpath(candidate), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.push(path.basename(candidate)); candidate = path.dirname(candidate);
    }
  }
}
async function safeDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await safeDirectory(parent);
  try { await fs.mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState('Crate output contains a symlink or non-directory', { directory });
}
async function implementation() {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const modules = ['production/procedural-crate', 'tools/procedural-crate', 'packages/format-v2', 'review/previews', 'review/document', 'review/appearance', 'review/geometry-views', 'review/settings', 'inspection/gltf', 'inspection/image', 'domain/asset-policy', 'production/ktx2'];
  const files = [];
  for (const id of modules) files.push({ id, sha256: hash(await readRegular(fileURLToPath(new URL(`../${id}${extension}`, import.meta.url)))) });
  const libraries = [];
  for (const name of ['@gltf-transform/core', '@gltf-transform/extensions', 'zod', 'pngjs', 'jpeg-js']) {
    const entrypoint = fileURLToPath(import.meta.resolve(name));
    let directory = path.dirname(entrypoint);
    for (;;) {
      try {
        const metadataBytes = await readRegular(path.join(directory, 'package.json'));
        const metadata = JSON.parse(metadataBytes.toString()) as { name?: unknown; version?: unknown };
        if (metadata.name === name && typeof metadata.version === 'string') {
          libraries.push({ name, version: metadata.version, entrypointSHA256: hash(await readRegular(entrypoint, 16 * 1024 * 1024)), metadataSHA256: hash(metadataBytes) });
          break;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(directory);
      if (parent === directory) throw invalidState('Cannot identify installed crate dependency', { name });
      directory = parent;
    }
  }
  const unboundDependencies = ['Recorded local files, library entrypoints and metadata are not a complete transitive installed-byte closure.', 'Native runtime, operating system and filesystem bytes are unbound; Node version is recorded.'];
  return { scope: 'local-renderer-validator-files-and-package-entrypoints', files, libraries, nodeVersion: process.version, renderer: REVIEW_RENDERER, previewSettings, unboundDependencies };
}
async function plan(configured: string, recipe: ProceduralCrateRecipe, packageMetadata: PackageMetadata) {
  const outputDir = await canonicalOutput(configured);
  const identity = await implementation();
  const fingerprint = hash(json({ recipe, packageMetadata, outputDir, identity }));
  return { schema: 'game_dev.procedural_crate_plan.v1', fingerprint, recipe, packageMetadata, outputDir,
    artifactDir: path.join(outputDir, '.production', 'procedural-crates', fingerprint), identity,
    executes: false, paid: false, cpuOnly: true,
    operation: { name: 'construct_procedural_crate', arguments: { recipe, packageMetadata, approvedFingerprint: fingerprint } },
    evidenceCeiling: 'Bounded local CPU geometry validation and appearance previews; no package, engine admission, hardware performance or human approval.',
  };
}

async function construct(configured: string, recipe: ProceduralCrateRecipe, packageMetadata: PackageMetadata, approvedFingerprint: string) {
  const approved = await plan(configured, recipe, packageMetadata);
  if (approved.fingerprint !== approvedFingerprint) throw invalidState('Crate approval fingerprint changed; plan and review the current recipe, implementation, renderer and output again.');
  const parent = path.dirname(approved.artifactDir);
  await safeDirectory(parent);
  return withTransaction(approved.artifactDir, async () => {
    await safeDirectory(parent);
    const stage = await fs.mkdtemp(path.join(parent, '.crate-stage-'));
    try {
      const built = await generateProceduralCrate(recipe);
      const files = new Map<string, Uint8Array | string>([
        ['recipe.json', json(built.recipe)], ['source.glb', built.source.bytes],
        ['lod0.glb', built.runtime.lods[0]!.bytes], ['lod1.glb', built.runtime.lods[1]!.bytes],
        ['collision.glb', built.collision.bytes],
        ['lod-chain.json', json({ ...built.runtime.lodChain, levels: built.runtime.lodChain.levels.map(level => ({ ...level, path: `${level.id}.glb`, sha256: hash(built.runtime.lods[level.level]!.bytes) })) })],
      ]);
      const write = async (name: string, bytes: Uint8Array | string) => {
        const handle = await fs.open(path.join(stage, name), 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      };
      for (const [name, bytes] of files) await write(name, bytes);
      const validation: Record<string, unknown> = {};
      for (const name of ['source.glb', 'lod0.glb', 'lod1.glb', 'collision.glb']) {
        const inspection = await inspectGltf(path.join(stage, name));
        const report = evaluateAsset(inspection);
        if (!report.passed) throw invalidState('Procedural crate failed local geometry validation', { name, report });
        validation[name] = { triangles: inspection.triangleCount, report };
      }
      files.set('validation.json', json({ schema: 'game_dev.procedural_crate_validation.v1', validation }));
      const previews = await previewGlb(built.runtime.lods[0]!.bytes, previewSettings);
      const previewNames: string[] = [];
      for (const [i, image] of previews.appearance.entries()) {
        if (!image.startsWith('data:image/png;base64,')) throw invalidState('CPU appearance renderer returned an unsupported image');
        const name = `preview-${i}.png`;
        files.set(name, Buffer.from(image.slice('data:image/png;base64,'.length), 'base64'));
        previewNames.push(name);
      }
      if (!previewNames.length) throw invalidState('CPU appearance renderer produced no previews');
      files.set('preview-evidence.json', json({ schema: 'game_dev.procedural_crate_preview.v1', renderer: previews.renderer,
        settings: previewSettings, framing: previews.framing, warnings: previews.warnings, uvEvidence: previews.uvEvidence,
        evidenceCeiling: approved.evidenceCeiling, implementation: approved.identity }));
      const receipt = { schema: 'game_dev.procedural_crate_receipt.v1', fingerprint: approved.fingerprint,
        recipe: built.recipe, packageMetadata, identity: approved.identity, limitations: [...built.limitations, ...approved.identity.unboundDependencies],
        files: [...files.entries()].map(([name, bytes]) => ({ path: name, sha256: hash(bytes), bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength })),
      };
      files.set('receipt.json', json(receipt));
      for (const [name, bytes] of files) if (!['recipe.json', 'source.glb', 'lod0.glb', 'lod1.glb', 'collision.glb', 'lod-chain.json'].includes(name)) await write(name, bytes);
      if ((await plan(configured, recipe, packageMetadata)).fingerprint !== approved.fingerprint) throw invalidState('Crate implementation or output changed during construction; refusing publication');
      await safeDirectory(parent);
      let reused = false;
      let existing = false;
      try { await fs.lstat(approved.artifactDir); existing = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (existing) {
        const stat = await fs.lstat(approved.artifactDir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState('Existing crate output is not a regular directory');
        const names = (await fs.readdir(approved.artifactDir)).sort();
        if (json(names) !== json([...files.keys()].sort())) throw invalidState('Existing crate output contains missing or unexpected artifacts');
        for (const [name, expected] of files) {
          const actual = await readRegular(path.join(approved.artifactDir, name));
          if (hash(actual) !== hash(expected)) throw invalidState('Existing crate artifact changed; preserving it and refusing reuse', { name });
        }
        reused = true;
      } else {
        await fs.rename(stage, approved.artifactDir);
      }
      const absolute = (name: string) => path.join(approved.artifactDir, name);
      const generalizedPackageRequest = generalizedPackageRequestSchema.parse({ ...packageMetadata, kind: 'mesh', primary: 'lod0.glb', artifacts: [
        { path: 'source.glb', sourcePath: absolute('source.glb'), role: 'editable-source' },
        { path: 'lod0.glb', sourcePath: absolute('lod0.glb'), role: 'mesh' },
        { path: 'lod1.glb', sourcePath: absolute('lod1.glb'), role: 'lod', level: 1 },
        { path: 'collision.glb', sourcePath: absolute('collision.glb'), role: 'collision' },
        { path: 'lod-chain.json', sourcePath: absolute('lod-chain.json'), role: 'lod-chain' },
        { path: 'recipe.json', sourcePath: absolute('recipe.json'), role: 'recipe' },
        { path: 'validation.json', sourcePath: absolute('validation.json'), role: 'metadata' },
        { path: 'preview-evidence.json', sourcePath: absolute('preview-evidence.json'), role: 'metadata' },
        { path: 'construction-receipt.json', sourcePath: absolute('receipt.json'), role: 'metadata' },
        ...previewNames.map(name => ({ path: name, sourcePath: absolute(name), role: 'preview' })),
      ] });
      const visuals: VisualAttachment[] = previewNames.map(name => ({ path: absolute(name), mimeType: 'image/png', role: 'render_preview', label: 'Procedural crate CPU appearance preview', colorimetry: 'srgb', width: 128, height: 128 }));
      return ok({ schema: 'game_dev.procedural_crate_constructed.v1', fingerprint: approved.fingerprint, reused,
        artifactDir: approved.artifactDir, modelPath: absolute('lod0.glb'), sourcePath: absolute('source.glb'),
        recipePath: absolute('recipe.json'), lodPaths: [absolute('lod0.glb'), absolute('lod1.glb')],
        collisionPath: absolute('collision.glb'), lodChainPath: absolute('lod-chain.json'),
        validationPath: absolute('validation.json'), previewPaths: previewNames.map(absolute),
        manifestPath: absolute('receipt.json'), receiptPath: absolute('receipt.json'),
        receiptSHA256: hash(files.get('receipt.json')!), generalizedPackageRequest, packageMetadata,
        limitations: [...built.limitations, ...approved.identity.unboundDependencies], evidenceCeiling: approved.evidenceCeiling,
        nextOperation: { name: 'plan_generalized_package', arguments: { request: generalizedPackageRequest }, note: 'Read-only package planning retains the complete source/runtime evidence bundle. License and source references are selected declarations; no shipping rights or package admission are inferred.' },
      }, visuals);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  });
}

export function registerProceduralCrateTools(server: ToolRegistrar, ctx: ToolContext): void {
  server.registerTool('plan_procedural_crate', {
    title: 'Plan a deterministic procedural crate', description: 'Read-only normalized recipe and exact CPU construction fingerprint; no files or provider calls.',
    inputSchema: planInput.shape, inputPolicy: 'strict',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, guard(ctx.logger, 'plan_procedural_crate', async args => ok(await plan(ctx.config.outputDir, args.recipe, args.packageMetadata))));
  server.registerTool('construct_procedural_crate', {
    title: 'Construct and review a deterministic crate locally', description: 'Writes source, two real LODs, box collision, hashed receipt and bounded CPU appearance previews inside configured output. Requires current plan fingerprint. No package or engine admission.',
    inputSchema: constructInput.shape, inputPolicy: 'strict',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, guard(ctx.logger, 'construct_procedural_crate', async args => construct(ctx.config.outputDir, args.recipe, args.packageMetadata, args.approvedFingerprint)));
}
