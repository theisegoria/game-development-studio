import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  BASIS_COMMIT,
  BASIS_VERSION,
  hashBasisFile,
  requireBasis,
  runBasis,
  type BasisIdentity,
  type BasisRunner,
} from '../production/basis.js';
import { inspectKtx2, type Ktx2Info } from '../production/ktx2.js';
import { invalidInput, invalidState } from '../util/errors.js';
import type { RasterImage } from '../inspection/image.js';

/** Review caps intentionally match the CPU appearance renderer's current limits. */
export const BASIS_REVIEW_LIMITS = {
  maxTextureCount: 32,
  maxTexturePixels: 4_000_000,
  maxTotalPixels: 8_000_000,
  maxCompressedBytes: 8_000_000,
  /** All mip levels may be exported; 48 MiB covers the 4/3 mip-chain bound plus headers. */
  maxDecodedBytes: 48 * 1024 * 1024,
  timeoutMs: 60_000,
} as const;

const DDS_HEADER_BYTES = 148;
const DDS_MAGIC = 0x20534444;
const DDS_HEADER_SIZE = 124;
const DDS_FOURCC_DX10 = 0x30315844;
const DDS_DXGI_RGBA8_UNORM = 28;
const DDS_DXGI_RGBA8_UNORM_SRGB = 29;
const DDS_RESOURCE_DIMENSION_TEXTURE2D = 3;
const MAX_RUNNER_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface BasisReviewTextureInput {
  /** Stable glTF image index, used in evidence and to map decoded pixels back to a texture. */
  imageIndex: number;
  bytes: Uint8Array;
}

export interface BasisReviewTextureReceipt {
  imageIndex: number;
  sourceSha256: string;
  decodedSha256: string;
  width: number;
  height: number;
  levels: number;
  codec: Ktx2Info['codec'];
  transfer: Ktx2Info['transfer'];
  decodedBytes: number;
}

export interface BasisReviewEvidence {
  schema: 'gds.review.basis_decode.v1';
  /** Number of Basis subprocesses: version probe plus one export per image. */
  processCount: number;
  decoder: {
    sha256: string;
    supportedVersion: typeof BASIS_VERSION;
    upstreamCommit: typeof BASIS_COMMIT;
    output: 'rgba32-dx10-dds-v1';
  };
  textures: BasisReviewTextureReceipt[];
}

export interface BasisReviewDecodeResult {
  /** Base-level pixels in RGBA8 row-major order; DDS mip tails are validated but not retained. */
  images: Map<number, RasterImage>;
  evidence: BasisReviewEvidence;
}

export interface BasisReviewDecodeDeps {
  runner?: BasisRunner;
  identity?: BasisIdentity;
  /** Injectable monotonic clock for deadline tests. */
  now?: () => number;
}

interface PreflightTexture extends BasisReviewTextureInput {
  info: Ktx2Info;
  sourceSha256: string;
  decodedBytes: number;
  ddsBytes: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedDdsPayloadBytes(info: Pick<Ktx2Info, 'width' | 'height' | 'levels'>): number {
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) ||
      info.width < 4 || info.height < 4 || info.width > 8192 || info.height > 8192 ||
      info.width % 4 !== 0 || info.height % 4 !== 0 ||
      info.width * info.height > BASIS_REVIEW_LIMITS.maxTexturePixels ||
      !Number.isInteger(info.levels) || info.levels < 1 || info.levels > 14 ||
      info.levels > Math.floor(Math.log2(Math.max(info.width, info.height))) + 1) {
    throw invalidInput('Decoded DDS metadata is outside the bounded KTX2 review profile.');
  }
  let total = 0;
  for (let level = 0; level < info.levels; level += 1) {
    const width = Math.max(1, info.width >> level);
    const height = Math.max(1, info.height >> level);
    total += width * height * 4;
    if (!Number.isSafeInteger(total)) throw invalidInput('Decoded texture mip chain exceeds the safe integer range.');
  }
  return total;
}

function requireUint32(view: DataView, offset: number, name: string): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw invalidState(`Basis review DDS is truncated at ${name}.`);
  return view.getUint32(offset, true);
}

/**
 * Parse the exact DX10 DDS profile emitted by pinned Basis 2.50 `-export_dds RGBA32`.
 * The function accepts no legacy, block-compressed, array, cube, or trailing-payload forms.
 */
export function parseBasisRgba32Dds(bytes: Uint8Array, expected: Ktx2Info): RasterImage {
  if (!['srgb', 'linear'].includes(expected.transfer) || !['etc1s', 'uastc'].includes(expected.codec)) {
    throw invalidInput('Decoded DDS transfer or codec metadata is unsupported.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < DDS_HEADER_BYTES) {
    throw invalidState('Basis review DDS is truncated.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (requireUint32(view, 0, 'magic') !== DDS_MAGIC || requireUint32(view, 4, 'header size') !== DDS_HEADER_SIZE) {
    throw invalidState('Basis review DDS has an unsupported header.');
  }

  const flags = requireUint32(view, 8, 'flags');
  const height = requireUint32(view, 12, 'height');
  const width = requireUint32(view, 16, 'width');
  const pitch = requireUint32(view, 20, 'pitch');
  const depth = requireUint32(view, 24, 'depth');
  const levels = requireUint32(view, 28, 'mip count');
  const pixelFormatSize = requireUint32(view, 76, 'pixel format size');
  const pixelFormatFlags = requireUint32(view, 80, 'pixel format flags');
  const fourCC = requireUint32(view, 84, 'pixel format FourCC');
  const bitCount = requireUint32(view, 88, 'pixel format bit count');
  const rMask = requireUint32(view, 92, 'red mask');
  const gMask = requireUint32(view, 96, 'green mask');
  const bMask = requireUint32(view, 100, 'blue mask');
  const aMask = requireUint32(view, 104, 'alpha mask');
  const caps2 = requireUint32(view, 112, 'caps2');
  const dxgiFormat = requireUint32(view, 128, 'DXGI format');
  const resourceDimension = requireUint32(view, 132, 'resource dimension');
  const miscFlag = requireUint32(view, 136, 'misc flag');
  const arraySize = requireUint32(view, 140, 'array size');
  const miscFlags2 = requireUint32(view, 144, 'misc flags');

  // Pinned Basis exports through tinydds.h: mip flags are always set, pitch
  // and the single-image array field are zero. The linear format retains
  // its legacy RGBA masks; sRGB is encoded solely by the DX10 format.
  // See the pinned upstream encoder/3rdparty/tinydds.h TinyDDS_WriteImage.
  const expectedFlags = 0x21007;
  const expectedCaps = 0x401008;
  const legacyLinearMasks = expected.transfer === 'linear';
  const caps = requireUint32(view, 108, 'caps');
  const expectedDxgi = expected.transfer === 'srgb' ? DDS_DXGI_RGBA8_UNORM_SRGB : DDS_DXGI_RGBA8_UNORM;
  if (
    flags !== expectedFlags || width !== expected.width || height !== expected.height ||
    pitch !== 0 || depth !== 0 || levels !== expected.levels ||
    pixelFormatSize !== 32 || pixelFormatFlags !== 0x4 || fourCC !== DDS_FOURCC_DX10 ||
    bitCount !== (legacyLinearMasks ? 32 : 0) || rMask !== (legacyLinearMasks ? 0xff : 0) ||
    gMask !== (legacyLinearMasks ? 0xff00 : 0) || bMask !== (legacyLinearMasks ? 0xff0000 : 0) ||
    aMask !== (legacyLinearMasks ? 0xff000000 : 0) ||
    caps !== expectedCaps || caps2 !== 0 || dxgiFormat !== expectedDxgi ||
    resourceDimension !== DDS_RESOURCE_DIMENSION_TEXTURE2D || miscFlag !== 0 || arraySize !== 0 || miscFlags2 !== 0
  ) {
    throw invalidState('Basis review DDS header does not match the validated 2D RGBA8 KTX2 profile.');
  }

  const payloadBytes = expectedDdsPayloadBytes(expected);
  const expectedLength = DDS_HEADER_BYTES + payloadBytes;
  if (expectedLength > BASIS_REVIEW_LIMITS.maxDecodedBytes || bytes.byteLength !== expectedLength) {
    throw invalidState('Basis review DDS payload size does not match its validated mip chain.');
  }
  const baseBytes = expected.width * expected.height * 4;
  return {
    width: expected.width,
    height: expected.height,
    data: new Uint8Array(bytes.subarray(DDS_HEADER_BYTES, DDS_HEADER_BYTES + baseBytes)),
  };
}

function preflight(inputs: readonly BasisReviewTextureInput[]): PreflightTexture[] {
  if (!Array.isArray(inputs) || inputs.length > BASIS_REVIEW_LIMITS.maxTextureCount) {
    throw invalidInput(`Compressed appearance review supports at most ${BASIS_REVIEW_LIMITS.maxTextureCount} KTX2 images.`);
  }
  const seen = new Set<number>();
  let totalPixels = 0;
  let totalCompressedBytes = 0;
  let totalDecodedBytes = 0;
  const textures: PreflightTexture[] = [];
  for (const input of inputs) {
    if (!input || !Number.isInteger(input.imageIndex) || input.imageIndex < 0 || seen.has(input.imageIndex)) {
      throw invalidInput('Compressed review image indices must be unique non-negative integers.');
    }
    seen.add(input.imageIndex);
    if (!(input.bytes instanceof Uint8Array)) throw invalidInput('Compressed review image bytes must be a Uint8Array.');
    if (input.bytes.byteLength > BASIS_REVIEW_LIMITS.maxCompressedBytes) throw invalidInput('Compressed review KTX2 image exceeds the 8 MB limit.');
    totalCompressedBytes += input.bytes.byteLength;
    if (totalCompressedBytes > BASIS_REVIEW_LIMITS.maxCompressedBytes) throw invalidInput('Compressed review KTX2 bytes exceed the 8 MB limit.');
    // Copy only after both per-image and aggregate source budgets are known to fit.
    const bytes = new Uint8Array(input.bytes);
    const info = inspectKtx2(bytes);
    const pixels = info.width * info.height;
    if (pixels > BASIS_REVIEW_LIMITS.maxTexturePixels) throw invalidInput('Compressed review texture exceeds the 4 million pixel limit.');
    totalPixels += pixels;
    if (totalPixels > BASIS_REVIEW_LIMITS.maxTotalPixels) throw invalidInput('Compressed review textures exceed the 8 million total pixel limit.');
    const decodedBytes = expectedDdsPayloadBytes(info);
    totalDecodedBytes += DDS_HEADER_BYTES + decodedBytes;
    if (totalDecodedBytes > BASIS_REVIEW_LIMITS.maxDecodedBytes) throw invalidInput('Compressed review DDS output exceeds the 48 MiB decoded byte limit.');
    textures.push({ imageIndex: input.imageIndex, bytes, info, sourceSha256: sha256(bytes), decodedBytes, ddsBytes: DDS_HEADER_BYTES + decodedBytes });
  }
  return textures;
}

function remainingMs(deadline: number, now: () => number): number {
  const remaining = deadline - now();
  if (remaining <= 0) throw invalidState('Compressed appearance review exceeded its 60 second CPU decode deadline.');
  return remaining;
}

function checkRunnerOutput(result: { stdout: string; stderr: string }): void {
  if (Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8') > MAX_RUNNER_OUTPUT_BYTES) {
    throw invalidState('Basis review process output exceeded 2 MiB.');
  }
}

async function verifyReviewBasis(identity: BasisIdentity, runner: BasisRunner, cwd: string, deadline: number, now: () => number): Promise<void> {
  await assertBasisReviewIdentity(identity);
  const version = await runner(identity.path, ['-version'], cwd, Math.min(10_000, remainingMs(deadline, now)));
  checkRunnerOutput(version);
  if (!new RegExp(`\\bv?${BASIS_VERSION.replace('.', '\\.')}\\b`).test(version.stdout)) {
    throw invalidState(`Unsupported Basis Universal version; expected ${BASIS_VERSION}.`);
  }
  await assertBasisReviewIdentity(identity);
}

/** Static profile + content hash check; intentionally does not launch Basis. */
export async function assertBasisReviewIdentity(identity: BasisIdentity): Promise<void> {
  if (
    identity.supportedVersion !== BASIS_VERSION || identity.upstreamCommit !== BASIS_COMMIT ||
    !/^[a-f0-9]{64}$/.test(identity.sha256)
  ) throw invalidState('Compressed appearance review requires the pinned Basis 2.50 executable identity.');
  if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Basis executable identity changed during review.');
}

/**
 * Decode explicitly selected, already validated KTX2 image payloads for CPU appearance review.
 * This function is inert until called and never installs or discovers an executable itself.
 */
export async function decodeBasisKtxTextures(
  inputs: readonly BasisReviewTextureInput[],
  deps: BasisReviewDecodeDeps = {},
): Promise<BasisReviewDecodeResult> {
  const textures = preflight(inputs);
  const now = deps.now ?? (() => performance.now());
  const deadline = now() + BASIS_REVIEW_LIMITS.timeoutMs;
  const identity = deps.identity ?? await requireBasis();
  const runner = deps.runner ?? runBasis;
  if (!textures.length) {
    await assertBasisReviewIdentity(identity);
    await assertBasisReviewIdentity(identity);
    return {
      images: new Map(),
      evidence: {
        schema: 'gds.review.basis_decode.v1',
        processCount: 0,
        decoder: { sha256: identity.sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT, output: 'rgba32-dx10-dds-v1' },
        textures: [],
      },
    };
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gds-review-basis-'));
  const images = new Map<number, RasterImage>();
  const receipts: BasisReviewTextureReceipt[] = [];
  try {
    await verifyReviewBasis(identity, runner, temp, deadline, now);
    for (const texture of textures) {
      remainingMs(deadline, now);
      if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Basis executable identity changed before review transcoding.');
      const inputName = 'input.ktx2';
      const outputName = 'output.dds';
      const inputPath = path.join(temp, inputName);
      const outputPath = path.join(temp, outputName);
      await fs.writeFile(inputPath, texture.bytes, { flag: 'wx', mode: 0o600 });
      const beforeRun = (await fs.readdir(temp)).sort();
      if (beforeRun.length !== 1 || beforeRun[0] !== inputName) throw invalidState('Basis review scratch directory is not an exact input roster.');
      const result = await runner(identity.path, [
        '-export_dds', 'RGBA32', '-file', inputPath, '-output_file', outputPath,
        '-no_multithreading', '-max_threads', '1',
      ], temp, remainingMs(deadline, now));
      checkRunnerOutput(result);
      remainingMs(deadline, now);
      const roster = (await fs.readdir(temp)).sort();
      if (roster.length !== 2 || roster[0] !== inputName || roster[1] !== outputName) {
        throw invalidState('Basis review transcoder produced an unexpected file roster.');
      }
      const inputStat = await fs.lstat(inputPath);
      const outputStat = await fs.lstat(outputPath);
      if (!inputStat.isFile() || inputStat.isSymbolicLink() || inputStat.size !== texture.bytes.byteLength ||
          !outputStat.isFile() || outputStat.isSymbolicLink() || outputStat.size !== texture.ddsBytes ||
          outputStat.size > BASIS_REVIEW_LIMITS.maxDecodedBytes) {
        throw invalidState('Basis review transcoder output is not a bounded regular DDS file.');
      }
      const persistedInput = new Uint8Array(await fs.readFile(inputPath));
      if (sha256(persistedInput) !== texture.sourceSha256) throw invalidState('Basis review transcoder changed its KTX2 input file.');
      const dds = new Uint8Array(await fs.readFile(outputPath));
      const image = parseBasisRgba32Dds(dds, texture.info);
      if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Basis executable identity changed during review transcoding.');
      const decodedSha256 = sha256(image.data);
      images.set(texture.imageIndex, image);
      receipts.push({
        imageIndex: texture.imageIndex,
        sourceSha256: texture.sourceSha256,
        decodedSha256,
        width: texture.info.width,
        height: texture.info.height,
        levels: texture.info.levels,
        codec: texture.info.codec,
        transfer: texture.info.transfer,
        decodedBytes: texture.decodedBytes,
      });
      await fs.rm(inputPath, { force: true });
      await fs.rm(outputPath, { force: true });
      if ((await fs.readdir(temp)).length !== 0) throw invalidState('Basis review transcoder left unexpected scratch files.');
    }
    if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Basis executable identity changed before review evidence was sealed.');
    remainingMs(deadline, now);
    return {
      images,
      evidence: {
        schema: 'gds.review.basis_decode.v1',
        processCount: 1 + textures.length,
        decoder: {
          sha256: identity.sha256,
          supportedVersion: BASIS_VERSION,
          upstreamCommit: BASIS_COMMIT,
          output: 'rgba32-dx10-dds-v1',
        },
        textures: receipts,
      },
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
