import { Document, GLB_BUFFER, NodeIO } from '@gltf-transform/core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { BASIS_COMMIT, BASIS_VERSION, type BasisIdentity, type BasisRunner } from '../src/production/basis.js';
import { inspectKtx2, type Ktx2Info } from '../src/production/ktx2.js';
import { encodePNG } from '../src/inspection/image.js';
import { previewGlb } from '../src/review/previews.js';
import { reviewSettingsSchema } from '../src/review/settings.js';

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-compressed-appearance-'));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));

function makeKtx2(marker: number, transfer: 'srgb' | 'linear' = 'srgb'): Uint8Array {
  const bytes = new Uint8Array(176), view = new DataView(bytes.buffer);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const u64 = (offset: number, value: number) => view.setBigUint64(offset, BigInt(value), true);
  u32(12, 0); u32(16, 1); u32(20, 4); u32(24, 4); u32(28, 0); u32(32, 0); u32(36, 1); u32(40, 1); u32(44, 0);
  u32(48, 104); u32(52, 44); u32(56, 0); u32(60, 0); u64(64, 0); u64(72, 0);
  u32(104, 44); view.setUint16(108, 0, true); view.setUint16(110, 0, true); view.setUint16(112, 2, true); view.setUint16(114, 40, true);
  bytes[116] = 166; bytes[117] = transfer === 'srgb' ? 1 : 0; bytes[118] = transfer === 'srgb' ? 2 : 1;
  bytes[119] = 0; bytes[120] = 3; bytes[121] = 3; bytes[122] = 0; bytes[123] = 0;
  u64(80, 160); u64(88, 16); u64(96, 16); bytes.fill(marker, 160, 176);
  return bytes;
}

function makeDds(info: Ktx2Info, pixel: number): Uint8Array {
  const bytes = new Uint8Array(148 + info.width * info.height * 4), view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 0x20534444); u32(4, 124); u32(8, 0x1007); u32(12, info.height); u32(16, info.width); u32(20, info.width * 4);
  u32(24, 0); u32(28, 1); u32(76, 32); u32(80, 4); u32(84, 0x30315844); u32(88, 0);
  u32(92, 0); u32(96, 0); u32(100, 0); u32(104, 0); u32(108, 0x1000); u32(112, 0);
  u32(128, info.transfer === 'srgb' ? 29 : 28); u32(132, 3); u32(136, 0); u32(140, 1); u32(144, 0);
  for (let offset = 148; offset < bytes.length; offset += 4) bytes.set([pixel, 35, 65, 255], offset);
  return bytes;
}

interface RawTextureDef { source?: number; sampler?: number; extensions?: Record<string, unknown>; [key: string]: unknown }
interface RawTextureInfo { index: number; [key: string]: unknown }
interface RawMaterial {
  pbrMetallicRoughness?: { baseColorTexture?: RawTextureInfo; metallicRoughnessTexture?: RawTextureInfo; [key: string]: unknown };
  emissiveTexture?: RawTextureInfo;
  normalTexture?: RawTextureInfo;
  [key: string]: unknown;
}
interface RawImage { bufferView?: number; mimeType?: string; uri?: string; [key: string]: unknown }
interface RawBufferView { buffer: number; byteOffset?: number; byteLength: number; [key: string]: unknown }
interface RawJSON {
  buffers: Array<{ byteLength: number; uri?: string }>;
  bufferViews: RawBufferView[];
  images: RawImage[];
  textures: RawTextureDef[];
  materials: RawMaterial[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

function glbFromJsonAndBinary(raw: RawJSON, binary: Uint8Array): Uint8Array {
  const json = Buffer.from(JSON.stringify(raw), 'utf8');
  const jsonPadded = Buffer.alloc(Math.ceil(json.byteLength / 4) * 4, 0x20); json.copy(jsonPadded);
  const binPadded = Buffer.alloc(Math.ceil(binary.byteLength / 4) * 4); Buffer.from(binary).copy(binPadded);
  const total = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength;
  const output = Buffer.alloc(total);
  output.write('glTF', 0, 'ascii'); output.writeUInt32LE(2, 4); output.writeUInt32LE(total, 8);
  output.writeUInt32LE(jsonPadded.byteLength, 12); output.writeUInt32LE(0x4e4f534a, 16); jsonPadded.copy(output, 20);
  const binHeader = 20 + jsonPadded.byteLength;
  output.writeUInt32LE(binPadded.byteLength, binHeader); output.writeUInt32LE(0x004e4942, binHeader + 4); binPadded.copy(output, binHeader + 8);
  return new Uint8Array(output);
}

async function compressedFixture(reorder: boolean, transfer: 'srgb' | 'linear' = 'srgb', sharedLinearRoles = false, optionalPngFallback = false) {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]));
  const normals = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uv = doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0.5, 1]));
  const textureA = doc.createTexture('albedo').setMimeType('image/png').setImage(encodePNG({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(100) }));
  const textureB = doc.createTexture('emissive').setMimeType('image/png').setImage(encodePNG({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(180) }));
  const material = doc.createMaterial('mapped').setBaseColorTexture(textureA).setEmissiveTexture(textureB).setEmissiveFactor([0.3, 0.2, 0.1]).setMetallicFactor(0);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normals).setAttribute('TEXCOORD_0', uv).setMaterial(material);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)));
  const base = await new NodeIO().writeBinary(doc);
  const jsonDoc = await new NodeIO().binaryToJSON(base);
  const raw = jsonDoc.json as unknown as RawJSON;
  if (raw.images.length !== 2 || raw.textures.length !== 2 || raw.materials.length !== 1) throw new Error('Unexpected simple fixture serialization');
  const pngFallbacks = structuredClone(raw.images);
  const ktxByOriginalImage = [makeKtx2(41, transfer), makeKtx2(93, transfer)];
  let binary = new Uint8Array(jsonDoc.resources[GLB_BUFFER]!);
  const append = (image: RawImage, payload: Uint8Array) => {
    const offset = Math.ceil(binary.byteLength / 4) * 4;
    const expanded = new Uint8Array(offset + payload.byteLength); expanded.set(binary); expanded.set(payload, offset); binary = expanded;
    const bufferView = raw.bufferViews.length; raw.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: payload.byteLength });
    image.bufferView = bufferView; image.mimeType = 'image/ktx2'; delete image.uri;
  };
  raw.images.forEach((image, index) => append(image, ktxByOriginalImage[index]!));

  const originalTextureDefs = structuredClone(raw.textures);
  const alias = structuredClone(originalTextureDefs[0]!);
  const oldTextureDefs = [...originalTextureDefs, alias];
  const materialDef = raw.materials[0]!;
  const oldBaseIndex = materialDef.pbrMetallicRoughness?.baseColorTexture?.index;
  const oldEmissiveIndex = materialDef.emissiveTexture?.index;
  if (oldBaseIndex === undefined || oldEmissiveIndex === undefined) throw new Error('Fixture material texture references were not serialized');
  const orderedIndices = reorder ? [1, 2, 0] : [0, 1, 2];
  const oldToNew = new Map(orderedIndices.map((old, index) => [old, index]));
  raw.textures = orderedIndices.map(oldIndex => {
    const def = oldTextureDefs[oldIndex]!;
    const oldSource = def.source;
    if (oldSource === undefined) throw new Error('Fixture source texture omitted its image index');
    const mappedSource = reorder ? 1 - oldSource : oldSource;
    if (optionalPngFallback) def.source = 2 + oldSource;
    else delete def.source;
    def.extensions = { ...(def.extensions ?? {}), KHR_texture_basisu: { source: mappedSource } };
    return def;
  });
  materialDef.pbrMetallicRoughness!.baseColorTexture!.index = oldToNew.get(oldBaseIndex)!;
  materialDef.emissiveTexture!.index = oldToNew.get(oldEmissiveIndex)!;
  if (sharedLinearRoles) {
    if (reorder || transfer !== 'linear') throw new Error('Shared linear fixture expects linear metadata and canonical image order');
    const removedIndex = oldToNew.get(oldEmissiveIndex)!;
    const afterRemoval = (oldIndex: number) => oldToNew.get(oldIndex)! - Number(removedIndex < oldToNew.get(oldIndex)!);
    delete materialDef.pbrMetallicRoughness!.baseColorTexture;
    materialDef.pbrMetallicRoughness!.metallicRoughnessTexture = { index: afterRemoval(oldBaseIndex) };
    materialDef.normalTexture = { index: afterRemoval(2) };
    delete materialDef.emissiveTexture;
    raw.textures = raw.textures.filter((_, index) => index !== removedIndex);
    raw.images.splice(1, 1);
  }
  if (reorder) raw.images.reverse();
  if (optionalPngFallback) raw.images.push(...pngFallbacks);
  raw.extensionsUsed = [...new Set([...(raw.extensionsUsed ?? []), 'KHR_texture_basisu'])];
  if (optionalPngFallback) raw.extensionsRequired = (raw.extensionsRequired ?? []).filter(name => name !== 'KHR_texture_basisu');
  else raw.extensionsRequired = [...new Set([...(raw.extensionsRequired ?? []), 'KHR_texture_basisu'])];
  raw.buffers[0]!.byteLength = binary.byteLength;
  jsonDoc.resources[GLB_BUFFER] = binary;
  const outputImages = reorder ? [ktxByOriginalImage[1]!, ktxByOriginalImage[0]!] : ktxByOriginalImage;
  return { bytes: glbFromJsonAndBinary(raw, binary), images: outputImages };
}

async function patchRawGlb(bytes: Uint8Array, patch: (raw: RawJSON) => void): Promise<Uint8Array> {
  const jsonDoc = await new NodeIO().binaryToJSON(bytes), raw = jsonDoc.json as unknown as RawJSON;
  patch(raw);
  return glbFromJsonAndBinary(raw, new Uint8Array(jsonDoc.resources[GLB_BUFFER]!));
}

async function identityIn(root: string): Promise<BasisIdentity> {
  const executable = path.join(root, 'basisu-fixture'); await fs.writeFile(executable, 'identity bytes, never executed');
  const sha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  return { path: executable, sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT };
}

function runner(calls: string[][] = []): BasisRunner {
  return async (_executable, args, _cwd) => {
    calls.push([...args]);
    if (args[0] === '-version') return { stdout: `Basis Universal ${BASIS_VERSION}`, stderr: '' };
    const input = new Uint8Array(await fs.readFile(args[args.indexOf('-file') + 1]!));
    const output = args[args.indexOf('-output_file') + 1]!;
    await fs.writeFile(output, makeDds(inspectKtx2(input), input[input.length - 1]!));
    return { stdout: 'exported fixture DDS', stderr: '' };
  };
}

test('opt-in decoder maps image-derived NodeIO textures across reordered images, reordered texture indices and aliases', async () => {
  const root = await temporary(), identity = await identityIn(root), calls: string[][] = [];
  const normalOrder = await compressedFixture(false), reordered = await compressedFixture(true);
  const sourceHashes = [normalOrder.bytes, reordered.bytes].map(bytes => createHash('sha256').update(bytes).digest('hex'));
  const settings = { mode: 'appearance' as const, resolution: 128 as const, decodeBasisTextures: true };
  const left = await previewGlb(normalOrder.bytes, settings, { identity, runner: runner(calls) });
  const right = await previewGlb(reordered.bytes, settings, { identity, runner: runner(calls) });
  const fallback = await compressedFixture(false, 'srgb', false, true);
  const withFallback = await previewGlb(fallback.bytes, settings, { identity, runner: runner(calls) });
  expect(right.appearance).toEqual(left.appearance);
  expect(withFallback.appearance).toEqual(left.appearance);
  expect(left.basisDecode?.textures.map(item => [item.imageIndex, item.sourceSha256])).toEqual([
    [0, createHash('sha256').update(normalOrder.images[0]!).digest('hex')],
    [1, createHash('sha256').update(normalOrder.images[1]!).digest('hex')],
  ]);
  expect(right.basisDecode?.textures.map(item => [item.imageIndex, item.sourceSha256])).toEqual([
    [0, createHash('sha256').update(reordered.images[0]!).digest('hex')],
    [1, createHash('sha256').update(reordered.images[1]!).digest('hex')],
  ]);
  expect(left.basisDecode?.processCount).toBe(3);
  expect(right.basisDecode?.processCount).toBe(3);
  expect(withFallback.basisDecode?.processCount).toBe(3);
  expect(calls).toHaveLength(9);
  expect([normalOrder.bytes, reordered.bytes].map(bytes => createHash('sha256').update(bytes).digest('hex'))).toEqual(sourceHashes);
});

test('geometry reads declared Basis metadata without decode; appearance is explicit, PNG opt-in verifies identity without a process', async () => {
  const root = await temporary(), identity = await identityIn(root), calls: string[][] = [];
  const compressed = await compressedFixture(false);
  const geometry = await previewGlb(compressed.bytes);
  expect(geometry.basisDecode).toBeUndefined();
  expect(calls).toHaveLength(0);
  await expect(previewGlb(compressed.bytes, { mode: 'appearance', resolution: 128 })).rejects.toThrow(/decodeBasisTextures:true/);

  const doc = new Document(), buffer = doc.createBuffer();
  const position = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]));
  const uv = doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0.5, 1]));
  const image = encodePNG({ width: 1, height: 1, data: new Uint8Array([200, 80, 50, 255]) });
  const texture = doc.createTexture().setMimeType('image/png').setImage(image);
  const material = doc.createMaterial().setBaseColorTexture(texture).setMetallicFactor(0);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv).setMaterial(material))));
  const pngPreview = await previewGlb(await new NodeIO().writeBinary(doc), { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, { identity, runner: runner(calls) });
  expect(pngPreview.basisDecode).toMatchObject({ processCount: 0, textures: [], decoder: { sha256: identity.sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT } });
  expect(calls).toHaveLength(0);
  await fs.writeFile(identity.path, 'mutated after zero-decode preview');
  await expect(previewGlb(await new NodeIO().writeBinary(doc), { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, { identity, runner: runner(calls) })).rejects.toThrow(/identity changed/);
  expect(calls).toHaveLength(0);
});

test('decoder rejects incompatible transfer metadata before launching Basis and settings reject geometry opt-in', async () => {
  const root = await temporary(), identity = await identityIn(root), calls: string[][] = [];
  const linear = await compressedFixture(false, 'linear');
  await expect(previewGlb(linear.bytes, { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, { identity, runner: runner(calls) })).rejects.toThrow(/color transfer/);
  expect(calls).toHaveLength(0);
  expect(() => reviewSettingsSchema.parse({ mode: 'geometry', decodeBasisTextures: true })).toThrow(/only in appearance/);
  await expect(previewGlb(new Uint8Array(), { mode: 'appearance', resolution: 128, timeline: { clipIndex: 0, startSeconds: 0, endSeconds: 1, frameCount: 2 } })).rejects.toThrow(/Use previewReviewGlb/);
});

test('shared linear packed and normal roles are accepted for UASTC, while unsupported TEXCOORD fails before process launch', async () => {
  const root = await temporary(), identity = await identityIn(root), calls: string[][] = [];
  const compatible = await compressedFixture(false, 'linear', true);
  const preview = await previewGlb(compatible.bytes, { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, { identity, runner: runner(calls) });
  expect(preview.basisDecode?.textures).toHaveLength(1);
  expect(preview.basisDecode?.textures[0]?.codec).toBe('uastc');
  expect(calls).toHaveLength(2);

  const badMapping = await patchRawGlb((await compressedFixture(false)).bytes, raw => {
    const base = raw.materials[0]!.pbrMetallicRoughness!.baseColorTexture!;
    base.texCoord = 1;
  });
  const countBeforeInvalid = calls.length;
  await expect(previewGlb(badMapping, { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, { identity, runner: runner(calls) })).rejects.toThrow(/TEXCOORD_0 only/);
  expect(calls).toHaveLength(countBeforeInvalid);
});
