import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { packageArtifactFiles, type PackageManifest } from './reader.js';
import { sha256 } from '../storage/filesystem.js';
import { invalidInput, invalidState, notFound } from '../util/errors.js';

export const MAX_PACKAGE_RESOURCE_BYTES = 16 * 1024 * 1024;

/** The verified manifest is the allowlist; a resource never accepts a free path. */
export async function readPackageArtifact(packagePath: string, manifest: PackageManifest, requested: string): Promise<Buffer> {
  const artifact = packageArtifactFiles(manifest).find(file => file.path === requested);
  if (!artifact) throw notFound('package artifact', requested);
  if (artifact.bytes > MAX_PACKAGE_RESOURCE_BYTES) throw invalidInput('Package artifact exceeds the resource byte limit; use its local package file', { path: requested, maximumBytes: MAX_PACKAGE_RESOURCE_BYTES });
  let directory = path.resolve(packagePath);
  for (const segment of ['', ...artifact.path.split('/').slice(0, -1)]) {
    if (segment) directory = path.join(directory, segment);
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalidState('Package artifact traverses a symlink or non-directory');
  }
  const file = path.join(packagePath, ...artifact.path.split('/'));
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== artifact.bytes) throw invalidState('Package artifact is not the verified regular file');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== artifact.bytes) throw invalidState('Package artifact changed during verification');
    const bytes = Buffer.alloc(artifact.bytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, Math.min(64 * 1024, bytes.length - length), null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== artifact.bytes || sha256(bytes.subarray(0, length)) !== artifact.sha256) throw invalidState('Package artifact bytes no longer match the manifest');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
