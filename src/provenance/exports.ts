import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { SourceLedger } from './ledger.js';
import { invalidInput, invalidState, notFound } from '../util/errors.js';

export const MAX_SOURCE_EXPORT_BYTES = 16 * 1024 * 1024;
export type SourceExportFormat = 'inventory' | 'cyclonedx';

export function sourceExportUri(format: SourceExportFormat, digest: string): string {
  return `game-dev://sources/exports/${format}/${digest}`;
}

/** Fixed, content-addressed exports only; callers cannot supply filesystem paths. */
export async function readSourceExport(directory: string, format: SourceExportFormat, digest: string): Promise<Buffer> {
  if (!['inventory', 'cyclonedx'].includes(format) || !/^[a-f0-9]{64}$/.test(digest)) throw invalidInput('Invalid source export reference');
  const exports = path.join(directory, 'exports');
  await SourceLedger.open(exports); // same private-path checks as the ledger
  const file = path.join(exports, `${format}-${digest}.json`);
  let handle;
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_SOURCE_EXPORT_BYTES) throw invalidState('Source export is not a bounded regular file');
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > MAX_SOURCE_EXPORT_BYTES) throw invalidState('Source export changed during verification');
    const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_SOURCE_EXPORT_BYTES + 1));
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const result = bytes.subarray(0, length);
    if (length !== info.size || createHash('sha256').update(result).digest('hex') !== digest) throw invalidState('Source export bytes no longer match the reference');
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('source export', digest);
    throw error;
  } finally { await handle?.close(); }
}
