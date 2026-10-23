import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeneralizedPackage, planGeneralizedPackage } from '../src/packages/format-v2.js';
import { readPackage } from '../src/packages/reader.js';
import { MAX_PACKAGE_RESOURCE_BYTES, readPackageArtifact } from '../src/packages/resource-artifacts.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

/** Deterministic mono PCM container; no acoustic quality or audition claim. */
function wave(frameCount = 16): Buffer {
  const bytes = Buffer.alloc(44 + frameCount * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frameCount * 2, 40);
  for (let frame = 0; frame < frameCount; frame++) bytes.writeInt16LE((frame % 16) * 64, 44 + frame * 2);
  return bytes;
}
async function fixture(sourceBytes = wave()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'package-resource-')); roots.push(root);
  const sourcePath = path.join(root, 'tone.wav'); await fs.writeFile(sourcePath, sourceBytes);
  const requested = 'audio/tone.wav';
  const request = { kind: 'audio', name: 'Resource fixture', primary: requested, artifacts: [{ path: requested, sourcePath, role: 'audio' }] };
  const packagesRoot = path.join(root, 'packages');
  const planned = await planGeneralizedPackage(request, packagesRoot);
  const built = await buildGeneralizedPackage(request, packagesRoot, planned.fingerprint);
  const manifest = await readPackage(built.packagePath);
  return { root, packagePath: built.packagePath, manifest, requested, target: path.join(built.packagePath, requested), sourceBytes };
}

describe('verified package artifact resource reads', () => {
  it('returns actual rostered bytes from a verified generalized package', async () => {
    const item = await fixture();
    expect(item.manifest.schema).toBe('game_dev.asset_package.v2');
    expect(await readPackageArtifact(item.packagePath, item.manifest, item.requested)).toEqual(item.sourceBytes);
  });
  it('refuses unrostered files and path aliases even when matching bytes exist after verification', async () => {
    const item = await fixture();
    await fs.writeFile(path.join(item.packagePath, 'extra.wav'), item.sourceBytes);
    await fs.writeFile(path.join(path.dirname(item.packagePath), 'outside.wav'), item.sourceBytes);
    for (const requested of ['extra.wav', '../outside.wav', './audio/tone.wav', 'audio/../audio/tone.wav', 'audio//tone.wav', 'audio\\tone.wav', item.target]) {
      await expect(readPackageArtifact(item.packagePath, item.manifest, requested)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
  it.each(['symlink', 'hardlink'] as const)('refuses a same-byte %s installed after manifest verification', async kind => {
    const item = await fixture();
    const external = path.join(item.root, 'same-bytes.wav'); await fs.writeFile(external, item.sourceBytes);
    await fs.unlink(item.target);
    if (kind === 'symlink') await fs.symlink(external, item.target);
    else await fs.link(external, item.target);
    await expect(readPackageArtifact(item.packagePath, item.manifest, item.requested)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await fs.readFile(external)).toEqual(item.sourceBytes);
  });
  it('refuses a same-byte symlinked artifact ancestor installed after verification', async () => {
    const item = await fixture();
    const external = path.join(item.root, 'external-audio'); await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'tone.wav'), item.sourceBytes);
    await fs.rm(path.join(item.packagePath, 'audio'), { recursive: true });
    await fs.symlink(external, path.join(item.packagePath, 'audio'));
    await expect(readPackageArtifact(item.packagePath, item.manifest, item.requested)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await fs.readFile(path.join(external, 'tone.wav'))).toEqual(item.sourceBytes);
  });
  it('refuses same-length tampering after manifest verification', async () => {
    const item = await fixture();
    const changed = Buffer.from(item.sourceBytes); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    await fs.writeFile(item.target, changed);
    await expect(readPackageArtifact(item.packagePath, item.manifest, item.requested)).rejects.toMatchObject({ code: 'INVALID_STATE', message: 'Package artifact bytes no longer match the manifest' });
    expect(await fs.readFile(item.target)).toEqual(changed);
  });
  it('caps growth-after-stat reads at the verified byte size plus one', async () => {
    const item = await fixture();
    const open = fs.open.bind(fs);
    let grew = false, readBytes = 0;
    const allocations: number[] = [];
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === item.target) {
        const read = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', { value: async (...readArgs: Parameters<typeof read>) => {
          // The helper has completed both lstat and opened-handle stat before read.
          if (!grew) { grew = true; await fs.appendFile(item.target, Buffer.alloc(1024 * 1024)); }
          const positional = readArgs as unknown as [Buffer, number, number, number | null];
          allocations.push(positional[0].length);
          expect(positional[2]).toBeLessThanOrEqual(64 * 1024);
          const result = await read(...readArgs); readBytes += result.bytesRead;
          return result;
        } });
      }
      return handle;
    });
    try {
      await expect(readPackageArtifact(item.packagePath, item.manifest, item.requested)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    } finally { spy.mockRestore(); }
    expect(grew).toBe(true);
    expect(allocations).toEqual([item.sourceBytes.length + 1]);
    expect(readBytes).toBe(item.sourceBytes.length + 1);
  });
  it('refuses a verified artifact over the resource limit with an explicit local-file fallback', async () => {
    const item = await fixture(wave(MAX_PACKAGE_RESOURCE_BYTES / 2));
    expect(item.sourceBytes.length).toBeGreaterThan(MAX_PACKAGE_RESOURCE_BYTES);
    const open = vi.spyOn(fs, 'open');
    await expect(readPackageArtifact(item.packagePath, item.manifest, item.requested)).rejects.toMatchObject({
      code: 'INVALID_INPUT', message: expect.stringContaining('use its local package file'),
      details: { path: item.requested, maximumBytes: MAX_PACKAGE_RESOURCE_BYTES },
    });
    expect(open).not.toHaveBeenCalled();
    expect((await fs.stat(item.target)).size).toBe(item.sourceBytes.length);
  });
});
