import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssetPackage, readAssetPackage } from '../src/packages/format.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const roots: string[] = [];
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', platformDescriptor);
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-dev-fsync-'));
  roots.push(root);
  return {
    packagesRoot: path.join(root, 'packages'),
    sourcePath: await writeGameReadyGlb(path.join(root, 'source.glb')),
    name: 'Fsync Fixture',
  };
}

describe('package directory fsync', () => {
  it('builds and verifies a package using the native filesystem', async () => {
    const result = await buildAssetPackage(await fixture());
    expect((await readAssetPackage(result.packagePath)).packageId).toBe(result.manifest.packageId);
  });

  const scenarios = (['win32', 'darwin', 'linux'] as const).flatMap(platform =>
    (['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EIO', 'EACCES', 'ENOSPC'] as const).flatMap(code =>
      (['open', 'sync', 'close'] as const).flatMap(operation =>
        ([1, 2] as const).map(directory => ({ platform, code, operation, directory })))));

  it.each(scenarios)('$platform $operation $code at directory $directory', async ({ platform, code, operation, directory }) => {
    const options = await fixture();
    const error = Object.assign(new Error(`injected ${operation}: ${code}`), { code });
    const open = fs.open.bind(fs);
    let directoryOpens = 0;
    let closedHandles = 0;
    let openedHandles = 0;
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      // Only intercept directory handles; all package writes and validation use real I/O.
      if (!(await fs.stat(args[0])).isDirectory()) return open(...args);
      const inject = ++directoryOpens === directory;
      if (inject && operation === 'open') throw error;
      const handle = await open(...args);
      openedHandles++;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        if (inject && operation === 'sync') throw error;
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close();
        closedHandles++;
        if (inject && operation === 'close') throw error;
      });
      return handle;
    });

    const tolerated = code === 'EINVAL' || code === 'ENOTSUP'
      || (platform === 'win32' && (code === 'EPERM' || code === 'EISDIR'));
    if (tolerated) {
      const result = await buildAssetPackage(options);
      expect((await readAssetPackage(result.packagePath)).packageId).toBe(result.manifest.packageId);
      expect(directoryOpens).toBe(2);
    } else {
      await expect(buildAssetPackage(options)).rejects.toBe(error);
      expect(directoryOpens).toBe(directory);
    }
    expect(closedHandles).toBe(openedHandles);
    expect((await fs.readdir(options.packagesRoot)).filter(name => name.startsWith('.staging-'))).toEqual([]);
  });
});
