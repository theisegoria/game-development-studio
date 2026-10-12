import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRLightsPunctual, KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import { inspectGltf } from '../src/inspection/gltf.js';
import { encodePNG } from '../src/inspection/image.js';

let work: string;
beforeEach(async () => { work = await fs.mkdtemp(path.join(os.tmpdir(), 'inspection-extensions-')); });
afterEach(async () => { await fs.rm(work, { recursive: true, force: true }); });

it.each([false, true])('inspects required lights with clearcoat required=%s without changing source bytes', async (required) => {
  const doc = new Document();
  doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]));
  const clearcoat = doc.createExtension(KHRMaterialsClearcoat).setRequired(required);
  const texture = doc.createTexture('drawn-coat').setImage(encodePNG({ width: 2, height: 2, data: new Uint8Array(16).fill(255) })).setMimeType('image/png');
  const unused = doc.createTexture('unused-coat').setImage(texture.getImage()!).setMimeType('image/png');
  const material = doc.createMaterial().setExtension('KHR_materials_clearcoat', clearcoat.createClearcoat().setClearcoatTexture(texture));
  doc.createMaterial().setExtension('KHR_materials_clearcoat', clearcoat.createClearcoat().setClearcoatTexture(unused));
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material));
  const lights = doc.createExtension(KHRLightsPunctual).setRequired(true);
  const scene = doc.createScene().addChild(doc.createNode().setMesh(mesh)).addChild(doc.createNode().setExtension('KHR_lights_punctual', lights.createLight().setType('point')));
  doc.getRoot().setDefaultScene(scene);
  const file = path.join(work, 'lights.glb');
  await new NodeIO().registerExtensions([KHRLightsPunctual, KHRMaterialsClearcoat]).write(file, doc);
  const before = await fs.readFile(file);
  const report = await inspectGltf(file);
  expect(report.triangleCount).toBe(1);
  expect(report.boundingBox.sizeMeters).toEqual([1, 1, 1]);
  expect(report.textureCount).toBe(1);
  expect(report.textureResolutions.map((t) => t.name)).toEqual(['drawn-coat']);
  expect(report.warnings.join('\n')).not.toContain('Missing optional extension');
  expect(await fs.readFile(file)).toEqual(before);
});

it.each(['VENDOR_unknown', 'KHR_draco_mesh_compression', 'EXT_meshopt_compression'])('still rejects unsupported required %s', async (extension) => {
  const file = path.join(work, 'unsupported.gltf');
  await fs.writeFile(file, JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: [extension], extensionsRequired: [extension] }));
  await expect(inspectGltf(file)).rejects.toMatchObject({ code: 'INSPECTION_FAILED', message: expect.stringContaining(extension) });
});

it('keeps remote resources blocked for assets declaring supported extensions', async () => {
  const file = path.join(work, 'remote.gltf');
  await fs.writeFile(file, JSON.stringify({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_lights_punctual'],
    extensionsRequired: ['KHR_lights_punctual'],
    buffers: [{ uri: 'https://example.invalid/geometry.bin', byteLength: 36 }],
  }));
  await expect(inspectGltf(file)).rejects.toMatchObject({
    code: 'INSPECTION_FAILED', message: expect.stringContaining('Network request blocked'),
  });
});
