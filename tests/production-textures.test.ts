import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NodeIO } from '@gltf-transform/core';
import { afterEach, expect, it } from 'vitest';
import { encodePNG, decodeImage } from '../src/inspection/image.js';
import { prepareTextureVariant } from '../src/production/textures.js';
import { planPlatform } from '../src/production/platform.js';
import { validateRecipe } from '../src/production/recipes.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(kind: 'srgb' | 'normal' | 'mixed') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'production-textures-')); roots.push(root);
  const model = await writeGameReadyGlb(path.join(root, 'source.glb'));
  const io = new NodeIO(); const doc = await io.read(model); const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set(kind === 'normal' ? (i % 2 ? [128,128,255,255] : [255,128,128,255]) : (i % 2 ? [255,255,255,255] : [0,0,0,255]), i * 4);
  const texture = doc.createTexture('test').setImage(encodePNG({ width: 4, height: 4, data })).setMimeType('image/png'); const material = doc.getRoot().listMaterials()[0]!;
  if (kind === 'normal') material.setNormalTexture(texture); else material.setBaseColorTexture(texture);
  if (kind === 'mixed') material.setMetallicRoughnessTexture(texture);
  await io.write(model, doc); return { root, model, io };
}
it('resizes color PNG in linear light, embeds output, preserves original and reuses content address', async () => {
  const { root, model, io } = await fixture('srgb'); const before = await readFile(model);
  const result = await prepareTextureVariant(model, 1, path.join(root, 'out'));
  expect(result.resized[0]?.after).toEqual([1,1]);
  const doc = await io.read(result.outputPath); const pixel = decodeImage(doc.getRoot().listTextures()[0]!.getImage()!);
  expect(pixel.data[0]).toBeGreaterThan(180); expect(pixel.data[0]).toBeLessThan(195);
  expect(await readFile(model)).toEqual(before);
  expect((await prepareTextureVariant(model, 1, path.join(root, 'out'))).outputSHA256).toBe(result.outputSHA256);
});
it('renormalizes resized normal vectors and refuses mixed semantics', async () => {
  const normal = await fixture('normal'); const result = await prepareTextureVariant(normal.model, 1, path.join(normal.root, 'out'));
  const doc = await normal.io.read(result.outputPath); const pixel = decodeImage(doc.getRoot().listTextures()[0]!.getImage()!);
  const length = Math.hypot(pixel.data[0]! / 127.5 - 1, pixel.data[1]! / 127.5 - 1, pixel.data[2]! / 127.5 - 1);
  expect(length).toBeCloseTo(1, 2); expect(result.resized[0]?.normalRenormalized).toBe(true);
  const mixed = await fixture('mixed'); await expect(prepareTextureVariant(mixed.model, 1, path.join(mixed.root, 'out'))).rejects.toThrow(/ambiguous/);
});
it('platform resize inserts a real pre-normalization step into every applicable variant', () => {
  const plan = planPlatform({ schema: 'game_dev.platform_recipe.v1', id: 'resize', modelPath: '/example/source.glb', name: 'Prop', license: 'MIT', variants: [{ id: 'mobile', lodTriangles: [2000, 500], maxMaterials: 2, maxTextureSize: 512, textureMode: 'resize' }] });
  expect(plan.executable).toBe(true); expect(plan.recipe.steps[0]?.operation).toBe('prepare_texture_variant');
  expect(plan.recipe.steps.filter(s => s.operation === 'normalize_mesh').every(s => s.dependsOn.includes('v0_textures'))).toBe(true);
  validateRecipe(plan.recipe);
});
