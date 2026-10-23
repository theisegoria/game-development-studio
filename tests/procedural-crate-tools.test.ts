import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeneralizedPackage, generalizedPackageRequestSchema, planGeneralizedPackage, readGeneralizedPackage } from '../src/packages/format-v2.js';
import { registerProceduralCrateTools } from '../src/tools/procedural-crate.js';
import { connectTools } from './helpers/tool-harness.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const recipe = { dimensions: { width: 1, height: 1.2, depth: 0.8 }, seed: 7 };
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crate-tools-')); roots.push(root);
  const tools = await connectTools(registerProceduralCrateTools, root);
  const planned = await tools.call('plan_procedural_crate', { recipe });
  expect(planned.isError).toBe(false);
  const request = { recipe, approvedFingerprint: planned.payload.fingerprint };
  return { root: await fs.realpath(root), tools, planned, request };
}

describe('procedural crate tool construction slice', () => {
  it('plans without artifact writes and binds recipe/output/renderer with strict inputs', async () => {
    const { root, tools, planned, request } = await setup();
    expect(planned.payload.executes).toBe(false);
    expect(planned.payload.cpuOnly).toBe(true);
    await expect(fs.access(path.join(root, '.production'))).rejects.toThrow();
    expect((await tools.call('plan_procedural_crate', { recipe, arbitraryPath: '/tmp/nope' })).isError).toBe(true);
    expect((await tools.call('construct_procedural_crate', { ...request, arbitraryPath: '/tmp/nope' })).isError).toBe(true);
    expect((await tools.call('construct_procedural_crate', { ...request, recipe: { ...recipe, seed: 8 } })).payload.error).toBe('INVALID_STATE');
    expect((await tools.call('construct_procedural_crate', { ...request, approvedFingerprint: 'a'.repeat(64) })).isError).toBe(true);
    await expect(fs.access(path.join(root, '.production'))).rejects.toThrow();
  });
  it('publishes validated source/runtime/collision/previews and safely serializes identical requests', async () => {
    const { root, tools, request } = await setup();
    const results = await Promise.all([tools.call('construct_procedural_crate', request), tools.call('construct_procedural_crate', request)]);
    expect(results.map(result => result.isError)).toEqual([false, false]);
    expect(results.map(result => result.payload.reused).sort()).toEqual([false, true]);
    const payload = results[0]!.payload;
    expect(payload.modelPath).toBe(path.join(payload.artifactDir as string, 'lod0.glb'));
    expect(path.relative(root, payload.artifactDir as string).startsWith('..')).toBe(false);
    const receiptBytes = await fs.readFile(payload.receiptPath as string);
    expect(createHash('sha256').update(receiptBytes).digest('hex')).toBe(payload.receiptSHA256);
    const receipt = JSON.parse(receiptBytes.toString()) as { files: { path: string; sha256: string }[] };
    for (const file of receipt.files) {
      const bytes = await fs.readFile(path.join(payload.artifactDir as string, file.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    const previews = payload.previewPaths as string[];
    expect(previews.length).toBeGreaterThan(0);
    for (const file of previews) expect((await fs.readFile(file)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const validation = JSON.parse(await fs.readFile(payload.validationPath as string, 'utf8')) as { validation: Record<string, { report: { passed: boolean } }> };
    expect(Object.values(validation.validation).every(value => value.report.passed)).toBe(true);
    expect((payload.nextOperation as { name: string }).name).toBe('plan_generalized_package');
    expect((await fs.readdir(path.dirname(payload.artifactDir as string))).filter(name => name.endsWith('.lock') || name.startsWith('.crate-stage-'))).toEqual([]);
  });
  it('refuses changed outputs even when an old receipt has been rewritten to match the corruption', async () => {
    const { tools, request } = await setup();
    const built = await tools.call('construct_procedural_crate', request);
    expect(built.isError).toBe(false);
    const target = built.payload.modelPath as string;
    await fs.writeFile(target, 'tampered');
    const receiptPath = built.payload.receiptPath as string;
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')) as { files: { path: string; sha256: string; bytes: number }[] };
    const file = receipt.files.find(file => file.path === 'lod0.glb')!;
    file.sha256 = createHash('sha256').update('tampered').digest('hex'); file.bytes = 8;
    await fs.writeFile(receiptPath, JSON.stringify(receipt));
    const result = await tools.call('construct_procedural_crate', request);
    expect(result.isError).toBe(true); expect(result.payload.error).toBe('INVALID_STATE');
    expect(await fs.readFile(target, 'utf8')).toBe('tampered');
  });
  it('retains every construction artifact and relative LOD link in a separately approved generalized package', async () => {
    const { root, tools, request } = await setup();
    const result = await tools.call('construct_procedural_crate', request);
    expect(result.isError).toBe(false);
    const packageRequest = generalizedPackageRequestSchema.parse(result.payload.generalizedPackageRequest);
    expect(packageRequest.name).toBe('Procedural crate');
    expect(packageRequest.license).toBe('unknown');
    expect(packageRequest.provenance.references).toEqual([]);
    expect(packageRequest.primary).toBe('lod0.glb');
    expect(new Set(packageRequest.artifacts.map(artifact => artifact.sourcePath)).size).toBe(packageRequest.artifacts.length);
    expect(packageRequest.artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining(['source.glb', 'lod0.glb', 'lod1.glb', 'collision.glb', 'recipe.json', 'lod-chain.json', 'validation.json', 'preview-evidence.json', 'construction-receipt.json']));
    const packagesRoot = path.join(root, 'packages');
    await expect(fs.access(packagesRoot)).rejects.toThrow();
    const planned = await planGeneralizedPackage(packageRequest, packagesRoot);
    const built = await buildGeneralizedPackage(packageRequest, packagesRoot, planned.fingerprint);
    const manifest = await readGeneralizedPackage(built.packagePath);
    expect(manifest.artifacts).toHaveLength(packageRequest.artifacts.length);
    const chain = JSON.parse(await fs.readFile(path.join(built.packagePath, 'lod-chain.json'), 'utf8')) as { levels: { path: string; sha256: string }[] };
    expect(chain.levels.map(level => level.path)).toEqual(['lod0.glb', 'lod1.glb']);
    for (const level of chain.levels) expect(createHash('sha256').update(await fs.readFile(path.join(built.packagePath, level.path))).digest('hex')).toBe(level.sha256);
    const evidence = JSON.parse(await fs.readFile(path.join(built.packagePath, 'preview-evidence.json'), 'utf8')) as { implementation: { files: { id: string }[]; unboundDependencies: string[] } };
    expect(evidence.implementation.files.map(file => file.id)).toContain('review/previews');
    expect(evidence.implementation.unboundDependencies.join(' ')).toContain('not a complete transitive');
  });
  it('binds selected package metadata and source reference declarations into construction approval', async () => {
    const { tools } = await setup();
    const packageMetadata = { name: 'Authored crate', license: 'MIT', provenance: { origin: 'authored', references: [{ sourceId: 'crate-source', recordSha256: 'b'.repeat(64) }] } };
    const planned = await tools.call('plan_procedural_crate', { recipe, packageMetadata });
    const approvedFingerprint = planned.payload.fingerprint;
    expect((await tools.call('construct_procedural_crate', { recipe, packageMetadata: { ...packageMetadata, license: 'CC0-1.0' }, approvedFingerprint })).isError).toBe(true);
    const result = await tools.call('construct_procedural_crate', { recipe, packageMetadata, approvedFingerprint });
    expect(result.isError).toBe(false);
    const packageRequest = generalizedPackageRequestSchema.parse(result.payload.generalizedPackageRequest);
    expect(packageRequest.name).toBe('Authored crate'); expect(packageRequest.license).toBe('MIT');
    expect(packageRequest.provenance.references).toEqual(packageMetadata.provenance.references);
    expect((result.payload.nextOperation as { arguments: { request: unknown } }).arguments.request).toEqual(packageRequest);
  });
  it('rejects cached artifact growth after stat with bounded reads', async () => {
    const { tools, request } = await setup();
    const result = await tools.call('construct_procedural_crate', request);
    const target = result.payload.modelPath as string;
    const originalOpen = fs.open.bind(fs);
    let grew = false;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        const originalRead = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', { value: async (...readArgs: Parameters<typeof originalRead>) => {
          if (!grew) { grew = true; await fs.appendFile(target, Buffer.alloc(128 * 1024)); }
          return originalRead(...readArgs);
        } });
      }
      return handle;
    });
    try {
      const refused = await tools.call('construct_procedural_crate', request);
      expect(refused.isError).toBe(true); expect(refused.payload.message).toMatch(/changed or exceeded/);
    } finally { spy.mockRestore(); }
    expect(grew).toBe(true);
  });
  it('refuses symlink destinations and symlink operation ancestors', async () => {
    const { root, tools, planned, request } = await setup();
    const external = path.join(root, 'external'); await fs.mkdir(external);
    await fs.symlink(external, path.join(root, '.production'));
    expect((await tools.call('construct_procedural_crate', request)).isError).toBe(true);
    expect(await fs.readdir(external)).toEqual([]);
    await fs.unlink(path.join(root, '.production'));
    await fs.mkdir(path.dirname(planned.payload.artifactDir as string), { recursive: true });
    await fs.symlink(external, planned.payload.artifactDir as string);
    expect((await tools.call('construct_procedural_crate', request)).isError).toBe(true);
    expect(await fs.readdir(external)).toEqual([]);
  });
});
