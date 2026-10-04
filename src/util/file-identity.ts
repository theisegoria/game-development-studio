import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { invalidState } from './errors.js';

/** Hash a bounded regular file with constant-size stream buffers. */
export async function boundedFileSHA256(file: string, maximumBytes = 256 * 1024 * 1024): Promise<string> {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
    throw invalidState('Executable identity requires a bounded regular file', { maximumBytes });
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw invalidState('Executable grew beyond the identity budget');
    hash.update(chunk);
  }
  const after = await fs.lstat(file);
  if (!after.isFile() || after.isSymbolicLink() || bytes !== before.size
    || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) {
    throw invalidState('Executable changed while its identity was measured');
  }
  return hash.digest('hex');
}
