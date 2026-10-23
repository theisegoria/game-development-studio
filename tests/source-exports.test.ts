import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MAX_SOURCE_EXPORT_BYTES, readSourceExport, sourceExportUri } from '../src/provenance/exports.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'source-export-'))); roots.push(root);
  const directory = path.join(root, '.provenance');
  const exports = path.join(directory, 'exports');
  await fs.mkdir(exports, { recursive: true });
  const bytes = Buffer.from('{"schema":"game_dev.source_ledger.v1","revision":0,"records":[]}\n');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(exports, `inventory-${digest}.json`);
  await fs.writeFile(file, bytes);
  return { root, directory, exports, bytes, digest, file };
}

it('retrieves a fixed export by its content identity and refuses altered bytes', async () => {
  const { directory, bytes, digest, file } = await fixture();
  expect(sourceExportUri('inventory', digest)).toBe(`game-dev://sources/exports/inventory/${digest}`);
  expect(await readSourceExport(directory, 'inventory', digest)).toEqual(bytes);
  await fs.writeFile(file, Buffer.alloc(bytes.length, 32));
  await expect(readSourceExport(directory, 'inventory', digest)).rejects.toThrow('no longer match');
});

it('refuses malformed and absent references without creating directories', async () => {
  const { root } = await fixture(); const absent = path.join(root, 'absent');
  for (const digest of ['../outside', '%2e%2e', 'A'.repeat(64), 'a'.repeat(63)]) {
    await expect(readSourceExport(absent, 'inventory', digest)).rejects.toThrow('Invalid source export');
  }
  await expect(readSourceExport(absent, 'inventory', 'a'.repeat(64))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(fs.stat(absent)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses symlink and hard-linked exports and private directory aliases', async () => {
  const { root, directory, digest, bytes, file, exports } = await fixture();
  const outside = path.join(root, 'outside.json'); await fs.writeFile(outside, bytes);
  await fs.rm(file); await fs.symlink(outside, file);
  await expect(readSourceExport(directory, 'inventory', digest)).rejects.toThrow('bounded regular file');
  await fs.rm(file); await fs.link(outside, file);
  await expect(readSourceExport(directory, 'inventory', digest)).rejects.toThrow('bounded regular file');
  await fs.rm(file); await fs.rmdir(exports); await fs.symlink(root, exports);
  await expect(readSourceExport(directory, 'inventory', digest)).rejects.toThrow('symlinks');
  expect(await fs.readFile(outside)).toEqual(bytes);
});

it('refuses oversized exports before serving bytes', async () => {
  const { directory, file, digest } = await fixture();
  await fs.truncate(file, MAX_SOURCE_EXPORT_BYTES + 1);
  await expect(readSourceExport(directory, 'inventory', digest)).rejects.toThrow('bounded regular file');
});
