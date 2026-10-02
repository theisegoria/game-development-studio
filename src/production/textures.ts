import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO, type Texture } from '@gltf-transform/core';
import { decodeImage, encodePNG, resizeImage, sniffImageFormat } from '../inspection/image.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { fileDigest } from './recipes.js';

/** Bounded embedded-GLB-only conversion; unknown extensions or texture semantics fail closed. */
export async function prepareTextureVariant(modelPath: string, maxTextureSize: number, outputRoot: string) {
  if (!Number.isInteger(maxTextureSize) || maxTextureSize < 1 || maxTextureSize > 8192) throw invalidInput('maxTextureSize must be an integer from 1 to 8192.');
  const info = await fs.lstat(modelPath);
  if (!info.isFile() || info.isSymbolicLink() || path.extname(modelPath).toLowerCase() !== '.glb') throw invalidInput('Texture preparation requires a regular embedded GLB file.');
  if (info.size > 128 * 1024 * 1024) throw invalidInput('Texture preparation input exceeds the 128 MiB memory budget.');
  const sourceSHA256 = await fileDigest(modelPath);
  const io = new NodeIO().setLogger({ debug() {}, info() {}, warn(message: string) { throw invalidState(`Texture conversion refuses unsupported document features: ${message}`); }, error(message: string) { throw invalidState(message); } });
  // readBinary cannot follow filesystem or network sidecars. Only fully embedded inputs are supported.
  const document = await io.readBinary(new Uint8Array(await fs.readFile(modelPath)));
  const kinds = new Map<Texture, Set<'srgb' | 'data' | 'normal'>>();
  const bind = (texture: Texture | null, kind: 'srgb' | 'data' | 'normal') => { if (texture) { const set = kinds.get(texture) ?? new Set(); set.add(kind); kinds.set(texture, set); } };
  for (const material of document.getRoot().listMaterials()) {
    bind(material.getBaseColorTexture(), 'srgb'); bind(material.getEmissiveTexture(), 'srgb');
    bind(material.getMetallicRoughnessTexture(), 'data'); bind(material.getOcclusionTexture(), 'data'); bind(material.getNormalTexture(), 'normal');
  }
  let totalPixels = 0;
  const resized = [];
  for (const [index, texture] of document.getRoot().listTextures().entries()) {
    const bytes = texture.getImage(); const size = texture.getSize();
    if (!bytes || !size) throw invalidState(`Texture ${index} has no readable image dimensions.`);
    const [width, height] = size;
    if (width <= maxTextureSize && height <= maxTextureSize) continue;
    const format = sniffImageFormat(bytes);
    if (!format) throw invalidState(`Texture ${index}: only PNG/JPEG resizing is supported.`);
    if (format === 'png' && bytes[24] === 16) throw invalidState(`Texture ${index}: resizing 16-bit PNG would lose precision; supply an authored 8-bit variant.`);
    totalPixels += width * height;
    if (width * height > 16_777_216 || totalPixels > 33_554_432) throw invalidInput('Texture decode exceeds the 16 MP per-image or 32 MP per-operation budget.');
    const usages = kinds.get(texture);
    if (!usages || usages.size !== 1) throw invalidState(`Texture ${index} has ambiguous color/data/normal semantics; split mixed-use textures before resizing.`);
    const kind = [...usages][0]!;
    const scale = Math.min(1, maxTextureSize / width, maxTextureSize / height);
    const output = resizeImage(decodeImage(bytes), Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)), { srgb: kind === 'srgb' });
    if (kind === 'normal') for (let at = 0; at < output.data.length; at += 4) {
      const x = output.data[at]! / 127.5 - 1; const y = output.data[at + 1]! / 127.5 - 1; const z = output.data[at + 2]! / 127.5 - 1;
      const length = Math.hypot(x, y, z);
      const vector = length > 1e-8 ? [x / length, y / length, z / length] : [0, 0, 1];
      for (let c = 0; c < 3; c++) output.data[at + c] = Math.round((vector[c]! + 1) * 127.5);
    }
    texture.setImage(encodePNG(output)).setMimeType('image/png').setURI(`texture_${index}.png`);
    resized.push({ index, kind, before: [width, height], after: [output.width, output.height], normalRenormalized: kind === 'normal' });
  }
  const bytes = await io.writeBinary(document);
  const outputSHA256 = createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(outputRoot, { recursive: true }); const outputPath = path.join(outputRoot, `${outputSHA256}.glb`);
  try { await fs.writeFile(outputPath, bytes, { flag: 'wx' }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await fileDigest(outputPath) !== outputSHA256) throw invalidState('Existing texture variant does not match content address.');
  }
  return { schema: 'game_dev.texture_variant.v1', sourceSHA256, outputPath, outputSHA256, maxTextureSize, resized, filter: 'area-average; sRGB decoded to linear light; data linear; normals renormalized', originalUnchanged: true };
}
