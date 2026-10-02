import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../packages/format.js';
import { writeFileAtomic } from './filesystem.js';
import type { MeshBatchItem, MeshBatchOptions } from '../domain/mesh-batch.js';
const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** Validate the GLB envelope and conservatively admit only self-contained resources.
 * A .glb extension is not evidence of closure: images and buffers may still use external URIs.
 * Unknown extensions may introduce other resource-reference semantics, so opt out of reuse.
 */
export function isClosedGlb(bytes: Buffer): boolean {
  try {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 ||
        bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return false;
    let offset = 12;
    let document: unknown;
    let chunks = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) return false;
      const length = bytes.readUInt32LE(offset);
      const type = bytes.readUInt32LE(offset + 4);
      if (length % 4 !== 0 || offset + 8 + length > bytes.length) return false;
      if (chunks === 0) {
        if (type !== 0x4e4f534a) return false;
        document = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
      } else if (chunks > 1 || type !== 0x004e4942) return false;
      chunks++; offset += length + 8;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document) ||
        (document as { asset?: { version?: unknown } }).asset?.version !== '2.0') return false;
    const closed = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return true;
      if (Array.isArray(value)) return value.every(closed);
      return Object.entries(value).every(([key, entry]) => {
        if (key === 'uri') return typeof entry === 'string' && entry.startsWith('data:');
        if (key === 'extensions' || key === 'extensionsUsed' || key === 'extensionsRequired') {
          if (entry && typeof entry === 'object' && Object.keys(entry).length === 0) return true;
          return false;
        }
        return closed(entry);
      });
    };
    return closed(document);
  } catch { return false; }
}
export class MeshCheckpoints {
  constructor(readonly directory: string, readonly toolIdentity: string) {}
  async key(source: string, options: MeshBatchOptions): Promise<string | undefined> {
    if (path.extname(source).toLowerCase() !== '.glb') return undefined;
    const bytes = await fs.readFile(source);
    if (!isClosedGlb(bytes)) return undefined;
    return hash(canonicalJson({ schema: 'org.gamedebug.mesh_checkpoint.v1', source: path.resolve(source),
      sourceSHA256: hash(bytes), options, toolIdentity: this.toolIdentity }));
  }
  async read(key: string): Promise<MeshBatchItem | undefined> {
    try {
      const record = JSON.parse(await fs.readFile(path.join(this.directory, `${key}.json`), 'utf8'));
      if (record.schema !== 'org.gamedebug.mesh_checkpoint.v1' || record.key !== key ||
          record.toolIdentity !== this.toolIdentity || record.item?.status !== 'prepared' ||
          typeof record.item.normalizedPath !== 'string' || typeof record.outputSHA256 !== 'string') return undefined;
      const output = await fs.readFile(record.item.normalizedPath);
      if (!isClosedGlb(output)) return undefined;
      if (hash(output) !== record.outputSHA256) return undefined;
      return { ...record.item, reused: true, checkpointKey: key } as MeshBatchItem;
    } catch { return undefined; } // Corrupt/missing checkpoints cannot authorize reuse.
  }
  async write(key: string, item: MeshBatchItem): Promise<void> {
    if (item.status !== 'prepared' || !item.normalizedPath) return;
    const bytes = await fs.readFile(item.normalizedPath);
    if (!isClosedGlb(bytes)) return;
    const outputSHA256 = hash(bytes);
    await fs.mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${key}.json`);
    await writeFileAtomic(destination, Buffer.from(JSON.stringify({ schema: 'org.gamedebug.mesh_checkpoint.v1', key,
      toolIdentity: this.toolIdentity, outputSHA256, item })));
  }
}
