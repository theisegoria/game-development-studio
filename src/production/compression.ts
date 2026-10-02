import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO, type Texture, type Document } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { readImageSize } from '../inspection/gltf.js';
import { decodeImage, encodePNG, sniffImageFormat } from '../inspection/image.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { inspectKtx2, isKtx2, type Ktx2Info } from './ktx2.js';
import { withTransaction } from '../storage/transaction.js';
import { requireBasis, runBasis, verifyBasisVersion, hashBasisFile, type BasisIdentity, type BasisRunner } from './basis.js';

export interface CompressionOptions { modelPath: string; outputRoot: string; colorCodec?: 'etc1s' | 'uastc'; quality?: number; timeoutSeconds?: number }
export interface CompressionDeps { runner?: BasisRunner; identity?: BasisIdentity }
const MAX_MODEL_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_PIXELS = 33_554_432;
function strictIO(): NodeIO { return new NodeIO().registerExtensions([KHRTextureBasisu]).setLogger({ debug() {}, info() {}, warn(message: string) { throw invalidState(`Unsupported document feature: ${message}`); }, error(message: string) { throw invalidState(message); } }); }
async function readEmbedded(file: string): Promise<{ bytes: Uint8Array; document: Document }> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MODEL_BYTES || path.extname(file).toLowerCase() !== '.glb') throw invalidInput('Compression requires a regular embedded GLB at most 128 MiB.');
  const bytes = new Uint8Array(await fs.readFile(file));
  if (bytes.byteLength > MAX_MODEL_BYTES) throw invalidInput('GLB grew beyond input byte budget.');
  return { bytes, document: await strictIO().readBinary(bytes) };
}
export async function validateKtxPayload(file: string, info: Ktx2Info, identity: BasisIdentity, runner: BasisRunner, cwd: string, timeoutMs: number): Promise<void> {
  if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Encoder identity changed before transcoding.');
  // Format 6 is BC7_RGBA in the pinned transcoder enum. This decodes every mip on CPU and writes nothing.
  const result = await runner(identity.path, ['-validate', '-file', file, '-format_only', '6', '-no_multithreading', '-max_threads', '1'], cwd, timeoutMs);
  for (let level = 0; level < info.levels; level++) {
    const width = Math.max(1, info.width >> level), height = Math.max(1, info.height >> level);
    const evidence = new RegExp(`Transcode of layer 0 level ${level} face 0 res ${width}x${height} format BC7(?:_RGBA)? succeeded`);
    if (!evidence.test(result.stdout)) throw invalidState(`CPU transcoder did not report success for mip ${level}; exit zero alone is insufficient.`);
  }
}
/** Returns evidence only after metadata and actual CPU transcoding; a report never substitutes for payload verification. */
export async function verifyCompressedModel(modelPath: string, deps: CompressionDeps = {}) {
  const { document } = await readEmbedded(modelPath);
  const textures = document.getRoot().listTextures().filter(t => t.getMimeType() === 'image/ktx2' || isKtx2(t.getImage() ?? new Uint8Array()));
  if (!textures.length) return { count: 0, cpuTranscoded: false, payloadSHA256: [] as string[] };
  const infos = textures.map(t => inspectKtx2(t.getImage()!));
  if (infos.reduce((sum, info) => sum + info.width * info.height, 0) > MAX_TOTAL_PIXELS || textures.length > 64) throw invalidInput('Compressed texture validation exceeds pixel/count budget.');
  const identity = deps.identity ?? await requireBasis(); const runner = deps.runner ?? runBasis;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'game-dev-ktx-verify-'));
  try {
    await verifyBasisVersion(identity, temp, runner);
    const payloadSHA256 = [];
    for (const [index, texture] of textures.entries()) {
      const bytes = texture.getImage()!; const file = path.join(temp, `${index}.ktx2`); await fs.writeFile(file, bytes, { flag: 'wx' });
      await validateKtxPayload(file, infos[index]!, identity, runner, temp, 60_000);
      payloadSHA256.push(createHash('sha256').update(bytes).digest('hex'));
    }
    return { count: textures.length, cpuTranscoded: true, payloadSHA256, encoder: { sha256: identity.sha256, supportedVersion: identity.supportedVersion, upstreamCommit: identity.upstreamCommit } };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export async function compressTextureVariant(options: CompressionOptions, deps: CompressionDeps = {}) {
  await fs.mkdir(options.outputRoot, { recursive: true });
  return withTransaction(path.join(options.outputRoot, 'basis-cpu'), () => compressTextureVariantLocked(options, deps));
}
async function compressTextureVariantLocked(options: CompressionOptions, deps: CompressionDeps) {
  const quality = options.quality ?? 128, timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
  if (!Number.isInteger(quality) || quality < 1 || quality > 255 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw invalidInput('Invalid compression quality or timeout budget.');
  if (options.colorCodec !== undefined && !['etc1s', 'uastc'].includes(options.colorCodec)) throw invalidInput('Unsupported color codec.');
  const { bytes: original, document } = await readEmbedded(options.modelPath);
  const sourceSHA256 = createHash('sha256').update(original).digest('hex');
  const kinds = new Map<Texture, Set<'srgb' | 'data' | 'normal'>>();
  const bind = (texture: Texture | null, kind: 'srgb' | 'data' | 'normal') => { if (texture) { const usages = kinds.get(texture) ?? new Set(); usages.add(kind); kinds.set(texture, usages); } };
  for (const material of document.getRoot().listMaterials()) {
    bind(material.getBaseColorTexture(), 'srgb'); bind(material.getEmissiveTexture(), 'srgb');
    bind(material.getNormalTexture(), 'normal'); bind(material.getOcclusionTexture(), 'data'); bind(material.getMetallicRoughnessTexture(), 'data');
  }
  const textures = document.getRoot().listTextures();
  if (!textures.length || textures.length > 64) throw invalidInput('Compression requires between 1 and 64 embedded textures.');
  let totalPixels = 0;
  const tasks = textures.map((texture, index) => {
    const bytes = texture.getImage(); const usages = kinds.get(texture);
    if (!bytes || !usages || usages.size !== 1) throw invalidState(`Texture ${index} has missing or ambiguous color/data semantics.`);
    const format = sniffImageFormat(bytes), size = readImageSize(bytes);
    if (!format || !size || (format === 'png' && bytes[24] === 16)) throw invalidInput(`Texture ${index} must be 8-bit PNG or JPEG; existing compressed/unsupported maps are not silently recompressed.`);
    if (size.width % 4 || size.height % 4 || size.width < 4 || size.height < 4 || size.width > 8192 || size.height > 8192 || size.width * size.height > 16_777_216) throw invalidInput(`Texture ${index} dimensions must be multiples of four within the 16 MP budget; prepare an explicit resized variant first.`);
    totalPixels += size.width * size.height;
    if (totalPixels > MAX_TOTAL_PIXELS) throw invalidInput('Compression exceeds the 32 MP total pixel budget.');
    return { texture, bytes, kind: [...usages][0]!, size, index };
  });
  const identity = deps.identity ?? await requireBasis(); const runner = deps.runner ?? runBasis;
  await fs.mkdir(options.outputRoot, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const remaining = () => { const left = deadline - Date.now(); if (left <= 0) throw invalidState('Compression operation exceeded its total time budget.'); return left; };
  const stage = await fs.mkdtemp(path.join(options.outputRoot, '.compression-')); const receipts = [];
  try {
    await verifyBasisVersion(identity, stage, runner);
    for (const task of tasks) {
      const input = path.join(stage, `input_${task.index}.png`), output = path.join(stage, `output_${task.index}.ktx2`);
      // Strip incidental source image color profiles; glTF material usage is the color authority.
      await fs.writeFile(input, encodePNG(decodeImage(task.bytes)), { flag: 'wx' });
      const codec = task.kind === 'srgb' ? options.colorCodec ?? 'etc1s' : 'uastc';
      const args = ['-ktx2', '-file', input, '-output_file', output, '-no_multithreading', '-max_threads', '1', '-mipmap', task.kind === 'srgb' ? '-srgb' : '-linear'];
      if (codec === 'uastc') args.push('-uastc', '-uastc_level', '2', '-ktx2_no_zstandard'); else args.push('-etc1s', '-q', String(quality), '-comp_level', '2');
      if (task.kind === 'normal') args.push('-normal_map', '-renorm', '-mip_renorm');
      if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Encoder identity changed before encoding.');
      await runner(identity.path, args, stage, remaining());
      const stat = await fs.lstat(output);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_MODEL_BYTES) throw invalidState('Encoder output is missing, not a regular file, or over budget.');
      const encoded = new Uint8Array(await fs.readFile(output));
      // Basis's linear preset may retain BT709 primaries. glTF non-color maps require UNSPECIFIED.
      if (task.kind !== 'srgb' && isKtx2(encoded) && encoded.length >= 80) {
        const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength); const at = view.getUint32(48, true);
        if (at + 16 <= encoded.length && view.getUint8(at + 14) === 1 && view.getUint8(at + 13) === 1) view.setUint8(at + 13, 0);
      }
      const info = inspectKtx2(encoded);
      if (info.width !== task.size.width || info.height !== task.size.height || info.codec !== codec || info.transfer !== (task.kind === 'srgb' ? 'srgb' : 'linear') || info.levels !== Math.floor(Math.log2(Math.max(info.width, info.height))) + 1) throw invalidState('Encoder output disagrees with requested texture dimensions, codec, transfer function or complete mip chain.');
      await fs.writeFile(output, encoded);
      await validateKtxPayload(output, info, identity, runner, stage, remaining());
      task.texture.setImage(encoded).setMimeType('image/ktx2').setURI(`texture_${task.index}.ktx2`);
      receipts.push({ index: task.index, kind: task.kind, ...info, inputSHA256: createHash('sha256').update(task.bytes).digest('hex'), outputSHA256: createHash('sha256').update(encoded).digest('hex'), cpuTranscoded: true });
    }
    document.createExtension(KHRTextureBasisu).setRequired(true);
    const outputBytes = await strictIO().writeBinary(document);
    if (outputBytes.length > MAX_MODEL_BYTES) throw invalidState('Compressed GLB exceeds output byte budget.');
    const outputSHA256 = createHash('sha256').update(outputBytes).digest('hex'); const outputPath = path.join(options.outputRoot, `${outputSHA256}.glb`);
    const stagedModel = path.join(stage, 'model.glb'); await fs.writeFile(stagedModel, outputBytes, { flag: 'wx' });
    try { await fs.link(stagedModel, outputPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await hashBasisFile(outputPath) !== outputSHA256) throw invalidState('Existing compressed variant does not match content address.');
    }
    return { schema: 'game_dev.texture_compression.v1', sourceSHA256, outputPath, outputSHA256, outputBytes: outputBytes.length, encoder: identity, textures: receipts, cpuOnly: true, gpuExecuted: false, qualityApproved: false, sourceUnchanged: true, note: 'CPU BC7 transcoding proves payload decodability; no engine import, visual approval, or cross-platform byte identity is claimed.' };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
