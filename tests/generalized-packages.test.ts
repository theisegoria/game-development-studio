import { promises as fs } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateProceduralCrate } from '../src/production/procedural-crate.js';
import { previewGlb } from '../src/review/previews.js';
import { canonicalJson, buildAssetPackage, readAssetPackage } from '../src/packages/format.js';
import { GENERALIZED_PACKAGE_LIMITS, buildGeneralizedPackage, generalizedPackageRequestSchema, planGeneralizedPackage, readGeneralizedPackage } from '../src/packages/format-v2.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function root() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'generalized-package-')); roots.push(directory); return fs.realpath(directory); }
async function declaredFixture(kind: 'audio' | 'material' | 'flipbook' = 'audio') {
  const directory = await root();
  const sourcePath = path.join(directory, 'source.dat'); await fs.writeFile(sourcePath, 'undeclared format bytes retained honestly');
  return { directory, packagesRoot: path.join(directory, 'packages'), request: { kind, name: 'Declared asset', primary: 'primary.dat', artifacts: [{ path: 'primary.dat', sourcePath, role: kind }] } };
}

describe('additive generalized package v2', () => {
  it('retains crate editable source, genuine LODs, collision, recipe, chain and CPU preview in one verified package', async () => {
    const directory = await root(), packagesRoot = path.join(directory, 'packages');
    const crate = await generateProceduralCrate({ dimensions: { width: 1, height: 1, depth: 1 } });
    const previews = await previewGlb(crate.runtime.lods[0]!.bytes, { mode: 'appearance', resolution: 128 });
    const contents = new Map<string, Uint8Array | string>([
      ['source.glb', crate.source.bytes], ['lod0.glb', crate.runtime.lods[0]!.bytes], ['lod1.glb', crate.runtime.lods[1]!.bytes],
      ['collision.glb', crate.collision.bytes], ['recipe.json', canonicalJson(crate.recipe)], ['lod-chain.json', canonicalJson(crate.runtime.lodChain)],
      ['preview.png', Buffer.from(previews.appearance[0]!.split(',')[1]!, 'base64')],
    ]);
    for (const [name, bytes] of contents) await fs.writeFile(path.join(directory, name), bytes);
    const reference = { sourceId: 'authored-crate', recordSha256: 'a'.repeat(64) };
    const request = { kind: 'mesh', name: 'Crate 箱', primary: 'runtime/lod0.glb', license: 'CC0-1.0', provenance: { origin: 'authored', references: [reference] }, artifacts: [
      { path: 'source/source.glb', sourcePath: path.join(directory, 'source.glb'), role: 'editable-source', provenanceRefs: [reference] },
      { path: 'runtime/lod0.glb', sourcePath: path.join(directory, 'lod0.glb'), role: 'mesh' },
      { path: 'runtime/lod1.glb', sourcePath: path.join(directory, 'lod1.glb'), role: 'lod', level: 1 },
      { path: 'runtime/collision.glb', sourcePath: path.join(directory, 'collision.glb'), role: 'collision' },
      { path: 'source/recipe.json', sourcePath: path.join(directory, 'recipe.json'), role: 'recipe' },
      { path: 'runtime/lod-chain.json', sourcePath: path.join(directory, 'lod-chain.json'), role: 'lod-chain' },
      { path: 'previews/preview.png', sourcePath: path.join(directory, 'preview.png'), role: 'preview' },
    ] };
    const planned = await planGeneralizedPackage(request, packagesRoot);
    await expect(fs.access(packagesRoot)).rejects.toThrow();
    const [first, second] = await Promise.all([buildGeneralizedPackage(request, packagesRoot, planned.fingerprint), buildGeneralizedPackage(request, packagesRoot, planned.fingerprint)]);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(first.manifest.packageId).toMatch(/^pkg_[a-f0-9]{24}$/);
    const verified = await readGeneralizedPackage(first.packagePath);
    expect(verified.artifacts).toHaveLength(7);
    expect(verified.kind).toBe('mesh'); expect(verified.primary).toBe('runtime/lod0.glb');
    expect(verified.provenance.references).toEqual([reference]);
    expect(verified.validation.quality).toBe('unverified');
    expect(verified.validation.kindChecks.map(check => check.triangles)).toEqual([12, 216, 12]);
    expect(verified.validation.kindChecks.every(check => check.passed)).toBe(true);
    for (const artifact of request.artifacts) expect(await fs.readFile(path.join(first.packagePath, artifact.path))).toEqual(await fs.readFile(artifact.sourcePath));
    expect((await planGeneralizedPackage({ ...request, artifacts: [...request.artifacts].reverse() }, packagesRoot)).manifest.packageId).toBe(first.manifest.packageId);
    const legacy = await buildAssetPackage({ packagesRoot: path.join(directory, 'legacy'), sourcePath: path.join(directory, 'lod0.glb'), name: 'Legacy crate' });
    expect((await readAssetPackage(legacy.packagePath)).schema).toBe('game_dev.asset_package.v1');
  });
  it.each(['audio', 'material', 'flipbook'] as const)('retains %s declarations without inventing semantic or quality validation', async kind => {
    const { request, packagesRoot } = await declaredFixture(kind);
    const planned = await planGeneralizedPackage(request, packagesRoot);
    expect(planned.manifest.validation.kindChecks[0]).toMatchObject({ check: 'declared-kind-only', passed: null });
    const built = await buildGeneralizedPackage(request, packagesRoot, planned.fingerprint);
    expect((await readGeneralizedPackage(built.packagePath)).kind).toBe(kind);
  });
  it('rejects missing/wrong primaries, traversal, aliases, incompatible levels and arbitrary destinations', async () => {
    const { request } = await declaredFixture();
    for (const primary of ['missing.dat', '../source.dat', '/absolute.dat', 'a/../primary.dat', 'Primary.dat']) expect(generalizedPackageRequestSchema.safeParse({ ...request, primary }).success).toBe(false);
    expect(generalizedPackageRequestSchema.safeParse({ ...request, primary: undefined }).success).toBe(false);
    expect(generalizedPackageRequestSchema.safeParse({ ...request, destination: '/tmp/arbitrary' }).success).toBe(false);
    expect(generalizedPackageRequestSchema.safeParse({ ...request, artifacts: [{ ...request.artifacts[0], role: 'material' }] }).success).toBe(false);
    for (const logical of ['a//b', 'a/./b', 'a\\b', 'con.txt', 'manifest.json', 'receipt.json', 'trailing.']) {
      expect(generalizedPackageRequestSchema.safeParse({ ...request, primary: logical, artifacts: [{ ...request.artifacts[0], path: logical }] }).success).toBe(false);
    }
    expect(generalizedPackageRequestSchema.safeParse({ ...request, artifacts: [...request.artifacts, request.artifacts[0]] }).success).toBe(false);
    expect(generalizedPackageRequestSchema.safeParse({ ...request, artifacts: [...request.artifacts, { ...request.artifacts[0], path: 'primary.dat/child' }] }).success).toBe(false);
    expect(generalizedPackageRequestSchema.safeParse({ ...request, artifacts: [{ ...request.artifacts[0], level: 0 }] }).success).toBe(false);
  });
  it('binds approved source identities and destination to prevent source drift or output redirection', async () => {
    const { directory, request, packagesRoot } = await declaredFixture();
    const planned = await planGeneralizedPackage(request, packagesRoot);
    await expect(buildGeneralizedPackage(request, path.join(directory, 'other'), planned.fingerprint)).rejects.toThrow(/plan changed/);
    await fs.writeFile(request.artifacts[0]!.sourcePath, 'changed');
    await expect(buildGeneralizedPackage(request, packagesRoot, planned.fingerprint)).rejects.toThrow(/plan changed/);
    await expect(fs.access(packagesRoot)).rejects.toThrow();
  });
  it('refuses physical source aliases, symlinks and hardlinks', async () => {
    const { directory, request, packagesRoot } = await declaredFixture();
    const duplicate = { ...request, artifacts: [...request.artifacts, { ...request.artifacts[0], path: 'second.dat' }] };
    await expect(planGeneralizedPackage(duplicate, packagesRoot)).rejects.toThrow(/alias/);
    const link = path.join(directory, 'link.dat'); await fs.symlink(request.artifacts[0]!.sourcePath, link);
    await expect(planGeneralizedPackage({ ...request, artifacts: [{ ...request.artifacts[0], sourcePath: link }] }, packagesRoot)).rejects.toThrow(/symbolic/);
    await fs.unlink(link); await fs.link(request.artifacts[0]!.sourcePath, link);
    await expect(planGeneralizedPackage(request, packagesRoot)).rejects.toThrow(/single-link/);
  });
  it('detects changed bytes, extra files and manifest tampering without repairing evidence', async () => {
    const { request, packagesRoot } = await declaredFixture();
    const planned = await planGeneralizedPackage(request, packagesRoot);
    const built = await buildGeneralizedPackage(request, packagesRoot, planned.fingerprint);
    const primary = path.join(built.packagePath, 'primary.dat'), original = await fs.readFile(primary);
    await fs.writeFile(primary, 'tampered');
    await expect(readGeneralizedPackage(built.packagePath)).rejects.toThrow(/hash verification/);
    await expect(buildGeneralizedPackage(request, packagesRoot, planned.fingerprint)).rejects.toThrow(/hash verification/);
    expect(await fs.readFile(primary, 'utf8')).toBe('tampered');
    await fs.writeFile(primary, original); await fs.writeFile(path.join(built.packagePath, 'extra'), 'unexpected');
    await expect(readGeneralizedPackage(built.packagePath)).rejects.toThrow(/unexpected files/);
    await fs.unlink(path.join(built.packagePath, 'extra'));
    const manifest = JSON.parse(await fs.readFile(built.manifestPath, 'utf8'));
    manifest.license = 'MIT'; await fs.writeFile(built.manifestPath, canonicalJson(manifest));
    await expect(readGeneralizedPackage(built.packagePath)).rejects.toThrow(/identity/);
  });
  it('enforces file count and byte budgets before package writes', async () => {
    const { directory, request, packagesRoot } = await declaredFixture();
    const artifacts = Array.from({ length: GENERALIZED_PACKAGE_LIMITS.artifacts + 1 }, (_, i) => ({ ...request.artifacts[0], path: `artifact-${i}.dat` }));
    expect(generalizedPackageRequestSchema.safeParse({ ...request, primary: 'artifact-0.dat', artifacts }).success).toBe(false);
    const large = path.join(directory, 'oversize.dat');
    const handle = await fs.open(large, 'wx');
    try { await handle.truncate(GENERALIZED_PACKAGE_LIMITS.artifactBytes + 1); } finally { await handle.close(); }
    await expect(planGeneralizedPackage({ ...request, artifacts: [{ ...request.artifacts[0], sourcePath: large }] }, packagesRoot)).rejects.toThrow(/bounded/);
    await expect(fs.access(packagesRoot)).rejects.toThrow();
  });
  it('rejects symlink publication ancestors and unexpected empty package directories', async () => {
    const { directory, request, packagesRoot } = await declaredFixture();
    const planned = await planGeneralizedPackage(request, packagesRoot);
    await fs.mkdir(packagesRoot); const external = path.join(directory, 'external'); await fs.mkdir(external);
    await fs.symlink(external, path.join(packagesRoot, 'v2'));
    await expect(buildGeneralizedPackage(request, packagesRoot, planned.fingerprint)).rejects.toThrow(/symlink/);
    expect(await fs.readdir(external)).toEqual([]);
    await fs.unlink(path.join(packagesRoot, 'v2'));
    const built = await buildGeneralizedPackage(request, packagesRoot, planned.fingerprint);
    await fs.mkdir(path.join(built.packagePath, 'extra-empty'));
    await expect(readGeneralizedPackage(built.packagePath)).rejects.toThrow(/unexpected directory/);
  });
  it('bounds growth after stat and records the actual validator identity without claiming full transitive closure', async () => {
    const { request, packagesRoot } = await declaredFixture();
    const sourcePath = request.artifacts[0]!.sourcePath;
    const originalOpen = fs.open.bind(fs);
    let grew = false;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === sourcePath) {
        const originalRead = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', { value: async (...readArgs: Parameters<typeof originalRead>) => {
          if (!grew) { grew = true; await fs.appendFile(sourcePath, Buffer.alloc(128 * 1024)); }
          return originalRead(...readArgs);
        } });
      }
      return handle;
    });
    try { await expect(planGeneralizedPackage(request, packagesRoot)).rejects.toThrow(/changed or exceeded/); }
    finally { spy.mockRestore(); }
    expect(grew).toBe(true);
    await expect(fs.access(packagesRoot)).rejects.toThrow();
    const planned = await planGeneralizedPackage(request, packagesRoot);
    expect(planned.manifest.implementation.files.map(file => file.id)).toEqual(expect.arrayContaining(['packages/format', 'domain/asset-policy', 'inspection/gltf', 'review/document']));
    expect(planned.manifest.implementation.libraries.map(library => library.name)).toEqual(['@gltf-transform/core', '@gltf-transform/extensions', 'zod']);
    expect(planned.manifest.implementation.libraries.every(library => library.version.length > 0 && library.entrypointSha256.length === 64)).toBe(true);
    expect(planned.manifest.implementation.unboundDependencies.join(' ')).toContain('not a complete installed-byte closure');
  });
  it('packages an actual animated GLB while limiting claims to static clip presence', async () => {
    const directory = await root();
    const crate = await generateProceduralCrate({ dimensions: { width: 1, height: 1, depth: 1 } });
    const doc = await new NodeIO().readBinary(crate.runtime.lods[0]!.bytes);
    const buffer = doc.getRoot().listBuffers()[0]!;
    const input = doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0, 1]));
    const output = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 0.1, 0]));
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    const channel = doc.createAnimationChannel().setSampler(sampler).setTargetNode(doc.getRoot().listNodes()[0]!).setTargetPath('translation');
    doc.createAnimation('move').addSampler(sampler).addChannel(channel);
    const sourcePath = path.join(directory, 'clip.glb'); await fs.writeFile(sourcePath, await new NodeIO().writeBinary(doc));
    const request = { kind: 'animation', name: 'Animated crate', primary: 'clip.glb', artifacts: [{ path: 'clip.glb', sourcePath, role: 'animation' }] };
    const packagesRoot = path.join(directory, 'packages');
    const planned = await planGeneralizedPackage(request, packagesRoot);
    const built = await buildGeneralizedPackage(request, packagesRoot, planned.fingerprint);
    expect((await readGeneralizedPackage(built.packagePath)).validation.kindChecks[0]).toMatchObject({ check: 'static-animation-presence', animationClips: 1, passed: true });
  });
  it('rejects an animation primary with no actual animation clips', async () => {
    const directory = await root(); const crate = await generateProceduralCrate({ dimensions: { width: 1, height: 1, depth: 1 } });
    const sourcePath = path.join(directory, 'animation.glb'); await fs.writeFile(sourcePath, crate.runtime.lods[0]!.bytes);
    await expect(planGeneralizedPackage({ kind: 'animation', name: 'Not an animation', primary: 'animation.glb', artifacts: [{ path: 'animation.glb', sourcePath, role: 'animation' }] }, path.join(directory, 'packages'))).rejects.toThrow(/no animation/);
  });
});
