import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../packages/format.js';
import { writeFileAtomic } from './filesystem.js';
import type { MeshBatchItem, MeshBatchOptions } from '../domain/mesh-batch.js';
const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** GLB embeds its dependencies. External glTF resources require a closure hash, so are never reused. */
export class MeshCheckpoints {
  constructor(readonly directory: string, readonly toolIdentity: string) {}
  async key(source: string, options: MeshBatchOptions): Promise<string | undefined> {
    if (path.extname(source).toLowerCase() !== '.glb') return undefined;
    return hash(canonicalJson({ schema: 'org.gamedebug.mesh_checkpoint.v1', source: path.resolve(source),
      sourceSHA256: hash(await fs.readFile(source)), options, toolIdentity: this.toolIdentity }));
  }
  async read(key: string): Promise<MeshBatchItem | undefined> {
    try {
      const record = JSON.parse(await fs.readFile(path.join(this.directory, `${key}.json`), 'utf8'));
      if (record.schema !== 'org.gamedebug.mesh_checkpoint.v1' || record.key !== key ||
          record.toolIdentity !== this.toolIdentity || record.item?.status !== 'prepared' ||
          typeof record.item.normalizedPath !== 'string' || typeof record.outputSHA256 !== 'string') return undefined;
      const output = await fs.readFile(record.item.normalizedPath);
      if (hash(output) !== record.outputSHA256) return undefined;
      return { ...record.item, reused: true, checkpointKey: key } as MeshBatchItem;
    } catch { return undefined; } // Corrupt/missing checkpoints cannot authorize reuse.
  }
  async write(key: string, item: MeshBatchItem): Promise<void> {
    if (item.status !== 'prepared' || !item.normalizedPath) return;
    const outputSHA256 = hash(await fs.readFile(item.normalizedPath));
    await fs.mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${key}.json`);
    await writeFileAtomic(destination, Buffer.from(JSON.stringify({ schema: 'org.gamedebug.mesh_checkpoint.v1', key,
      toolIdentity: this.toolIdentity, outputSHA256, item })));
  }
}
