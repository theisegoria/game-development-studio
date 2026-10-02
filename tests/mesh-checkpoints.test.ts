import { checkpointGlb } from './helpers/checkpoint-glb.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MeshCheckpoints } from '../src/storage/mesh-checkpoints.js';
import { parseBlenderReceipt, BLENDER_RECEIPT_SCHEMA } from '../src/domain/blender-receipt.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
it('only reuses verified content and invalidates source, policy, options, and tool changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-checkpoint-')); roots.push(root);
  const source = path.join(root, 'source.glb'); const output = path.join(root, 'output.glb');
  await fs.writeFile(source, checkpointGlb()); await fs.writeFile(output, checkpointGlb({ extras: { prepared: true } }));
  const store = new MeshCheckpoints(path.join(root, 'checkpoints'), 'tool-v1');
  const options = { normalize: true, skipAlreadyValid: true, policy: {} };
  const key = (await store.key(source, options))!;
  await store.write(key, { input: source, status: 'prepared', normalizedPath: output });
  expect((await store.read(key))?.reused).toBe(true);
  expect(await store.key(source, { ...options, policy: { maxTriangles: 100 } })).not.toBe(key);
  expect(await store.key(source, { ...options, skipAlreadyValid: false })).not.toBe(key);
  expect(await new MeshCheckpoints(store.directory, 'tool-v2').key(source, options)).not.toBe(key);
  await fs.writeFile(output, 'tampered'); expect(await store.read(key)).toBeUndefined();
  await fs.writeFile(source, 'changed'); expect(await store.key(source, options)).not.toBe(key);
  await fs.writeFile(path.join(store.directory, `${key}.json`), '{'); expect(await store.read(key)).toBeUndefined();
  expect(await store.key(path.join(root, 'external.gltf'), options)).toBeUndefined();
});
it('validates known receipt fields and versions while supporting legacy wrappers', () => {
  expect(parseBlenderReceipt({ trianglesAfter: 12 }).trianglesAfter).toBe(12);
  const receipt = { schema: BLENDER_RECEIPT_SCHEMA, operation: 'normalize_mesh', blenderVersion: '4.5', input: 'a', output: 'b', trianglesAfter: 1 };
  expect(parseBlenderReceipt(receipt)).toEqual(receipt);
  expect(() => parseBlenderReceipt({ ...receipt, schema: 'future' })).toThrow();
  expect(() => parseBlenderReceipt({ ...receipt, trianglesAfter: '1' })).toThrow();
  expect(() => parseBlenderReceipt({ trianglesAfter: -1 })).toThrow();
  expect(() => parseBlenderReceipt(null)).toThrow();
});

it('never checkpoints external-resource GLBs, even after dependency changes or a fake extension', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-closure-')); roots.push(root);
  const source = path.join(root, 'source.glb');
  const store = new MeshCheckpoints(path.join(root, 'checkpoints'), 'tool-v1');
  const options = { normalize: true, skipAlreadyValid: true, policy: {} };
  for (const fields of [{ images: [{ uri: 'texture.png' }] }, { buffers: [{ uri: 'mesh.bin', byteLength: 4 }] }]) {
    await fs.writeFile(source, checkpointGlb(fields));
    const dependency = path.join(root, 'images' in fields ? 'texture.png' : 'mesh.bin');
    await fs.writeFile(dependency, 'before');
    expect(await store.key(source, options)).toBeUndefined();
    await fs.writeFile(dependency, 'after');
    expect(await store.key(source, options)).toBeUndefined();
  }
  await fs.writeFile(source, '{"asset":{"version":"2.0"}}');
  expect(await store.key(source, options)).toBeUndefined();
  await fs.writeFile(source, checkpointGlb({ extensions: { FUTURE_resource: { file: 'external.bin' } } }));
  expect(await store.key(source, options)).toBeUndefined();
  await fs.writeFile(source, checkpointGlb({ images: [{ uri: 'data:image/png;base64,AAAA' }] }));
  expect(await store.key(source, options)).toMatch(/^[a-f0-9]{64}$/);
  const broken = checkpointGlb(); broken.writeUInt32LE(1, 8); await fs.writeFile(source, broken);
  expect(await store.key(source, options)).toBeUndefined();
});
