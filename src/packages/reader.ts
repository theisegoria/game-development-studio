/** Shared verified package dispatch. Neither legacy format module imports this dispatcher. */
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { readAssetPackage, type AssetPackageManifest } from './format.js';
import { readGeneralizedPackage, type GeneralizedPackageManifest } from './format-v2.js';
import { invalidInput, invalidState } from '../util/errors.js';

export type PackageManifest = AssetPackageManifest | GeneralizedPackageManifest;
export interface PackageArtifactFile { path: string; bytes: number; sha256: string }
async function manifestBytes(file: string): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 1024 * 1024) throw invalidInput('Package manifest must be a bounded regular single-link file');
    const data = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw invalidState('Package manifest changed during dispatch');
    return data.subarray(0, total);
  } finally { await handle.close(); }
}
export async function readPackage(packagePath: string): Promise<PackageManifest> {
  const root = path.resolve(packagePath), stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidInput('Package must be a real directory');
  const resolved = await fs.realpath(root), target = path.join(resolved, 'manifest.json');
  const before = await manifestBytes(target);
  const discriminator = JSON.parse(before.toString()) as { schema?: unknown };
  const manifest = discriminator?.schema === 'game_dev.asset_package.v1' ? await readAssetPackage(resolved)
    : discriminator?.schema === 'game_dev.asset_package.v2' ? await readGeneralizedPackage(resolved)
    : undefined;
  if (!manifest) throw invalidInput('Unsupported package manifest schema');
  if (!(await manifestBytes(target)).equals(before)) throw invalidState('Package manifest changed during verification');
  return manifest;
}
export function packageArtifactFiles(manifest: PackageManifest): readonly PackageArtifactFile[] {
  return manifest.schema === 'game_dev.asset_package.v1' ? manifest.files : manifest.artifacts;
}
export function packagePrimaryArtifact(manifest: PackageManifest): PackageArtifactFile {
  const primary = manifest.schema === 'game_dev.asset_package.v1' ? manifest.model : manifest.primary;
  const file = packageArtifactFiles(manifest).find(item => item.path === primary);
  if (!file) throw invalidState('Package manifest has no primary artifact');
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}
