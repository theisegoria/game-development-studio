import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASIS_COMMIT,
  BASIS_VERSION,
  type BasisIdentity,
  type BasisRunner,
} from '../src/production/basis.js';
import { inspectKtx2, type Ktx2Info } from '../src/production/ktx2.js';
import {
  BASIS_REVIEW_LIMITS,
  decodeBasisKtxTextures,
  parseBasisRgba32Dds,
  type BasisReviewTextureInput,
} from '../src/review/basis-textures.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-review-unit-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function makeKtx2(options: { width?: number; height?: number; levels?: number; transfer?: 'srgb' | 'linear'; codec?: 'etc1s' | 'uastc' } = {}): Uint8Array {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  const levels = options.levels ?? 1;
  const transfer = options.transfer ?? 'srgb';
  const codec = options.codec ?? 'uastc';
  const dfdOffset = 80 + levels * 24;
  const dfdLength = 44;
  const sgdOffset = codec === 'etc1s' ? Math.ceil((dfdOffset + dfdLength) / 8) * 8 : 0;
  const sgdLength = codec === 'etc1s' ? 20 + levels * 20 : 0;
  const firstLevelOffset = Math.ceil((sgdOffset + sgdLength || dfdOffset + dfdLength) / (codec === 'uastc' ? 16 : 1)) * (codec === 'uastc' ? 16 : 1);
  const levelData: Uint8Array[] = [];
  let levelBytes = 0;
  for (let level = 0; level < levels; level += 1) {
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    const size = codec === 'uastc' ? Math.ceil(levelWidth / 4) * Math.ceil(levelHeight / 4) * 16 : 16;
    levelData.push(new Uint8Array(size).fill(level + 1));
    levelBytes += size;
  }
  const fileLength = firstLevelOffset + levelBytes;
  const bytes = new Uint8Array(fileLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const u64 = (offset: number, value: number) => view.setBigUint64(offset, BigInt(value), true);
  u32(12, 0); // vkFormat
  u32(16, 1); // typeSize
  u32(20, width);
  u32(24, height);
  u32(28, 0); // depth
  u32(32, 0); // layerCount
  u32(36, 1); // faceCount
  u32(40, levels);
  u32(44, codec === 'etc1s' ? 1 : 0);
  u32(48, dfdOffset);
  u32(52, dfdLength);
  u32(56, 0);
  u32(60, 0);
  u64(64, sgdOffset);
  u64(72, sgdLength);
  const dfd = dfdOffset;
  u32(dfd, dfdLength);
  view.setUint16(dfd + 4, 0, true);
  view.setUint16(dfd + 6, 0, true);
  view.setUint16(dfd + 8, 2, true);
  view.setUint16(dfd + 10, dfdLength - 4, true);
  bytes[dfd + 12] = codec === 'etc1s' ? 163 : 166;
  bytes[dfd + 13] = transfer === 'srgb' ? 1 : 0;
  bytes[dfd + 14] = transfer === 'srgb' ? 2 : 1;
  bytes[dfd + 15] = 0;
  bytes[dfd + 16] = 3;
  bytes[dfd + 17] = 3;
  bytes[dfd + 18] = 0;
  bytes[dfd + 19] = 0;
  if (sgdLength) bytes.fill(7, sgdOffset, sgdOffset + sgdLength);
  let cursor = firstLevelOffset;
  for (let level = 0; level < levels; level += 1) {
    const data = levelData[level]!;
    u64(80 + level * 24, cursor);
    u64(88 + level * 24, data.length);
    u64(96 + level * 24, codec === 'uastc' ? data.length : 0);
    bytes.set(data, cursor);
    cursor += data.length;
  }
  return bytes;
}

function makeDds(info: Ktx2Info, basePixel = [17, 34, 51, 255]): Uint8Array {
  const payloadBytes = Array.from({ length: info.levels }, (_, level) => Math.max(1, info.width >> level) * Math.max(1, info.height >> level) * 4).reduce((sum, value) => sum + value, 0);
  const bytes = new Uint8Array(148 + payloadBytes);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 0x20534444);
  u32(4, 124);
  u32(8, 0x21007);
  u32(12, info.height);
  u32(16, info.width);
  u32(20, 0);
  u32(24, 0);
  u32(28, info.levels);
  u32(76, 32);
  u32(80, 0x4);
  u32(84, 0x30315844);
  u32(88, info.transfer === 'linear' ? 32 : 0);
  u32(92, info.transfer === 'linear' ? 0xff : 0);
  u32(96, info.transfer === 'linear' ? 0xff00 : 0);
  u32(100, info.transfer === 'linear' ? 0xff0000 : 0);
  u32(104, info.transfer === 'linear' ? 0xff000000 : 0);
  u32(108, 0x401008);
  u32(112, 0);
  u32(128, info.transfer === 'srgb' ? 29 : 28);
  u32(132, 3);
  u32(136, 0);
  u32(140, 0);
  u32(144, 0);
  let offset = 148;
  const pattern = Uint8Array.from(basePixel);
  for (let level = 0; level < info.levels; level += 1) {
    const levelBytes = Math.max(1, info.width >> level) * Math.max(1, info.height >> level) * 4;
    for (let at = 0; at < levelBytes; at += 4) bytes.set(level === 0 ? pattern : Uint8Array.of(0, 0, 0, 255), offset + at);
    offset += levelBytes;
  }
  return bytes;
}

async function identityIn(root: string): Promise<BasisIdentity> {
  const executable = path.join(root, 'basisu-fixture');
  await fs.writeFile(executable, 'fixture executable identity');
  const sha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  return { path: executable, sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT };
}

function decodeRunner(ddsFor: (info: Ktx2Info) => Uint8Array, calls: string[][] = [], afterDecode?: (cwd: string, input: string, output: string) => Promise<void>): BasisRunner {
  return async (_executable, args, cwd) => {
    calls.push([...args]);
    if (args[0] === '-version') return { stdout: `Basis Universal ${BASIS_VERSION}`, stderr: '' };
    const input = args[args.indexOf('-file') + 1]!;
    const output = args[args.indexOf('-output_file') + 1]!;
    const ktx = new Uint8Array(await fs.readFile(input));
    const info = inspectKtx2(ktx);
    await fs.writeFile(output, ddsFor(info), { flag: 'wx' });
    await afterDecode?.(cwd, input, output);
    return { stdout: 'DDS export complete', stderr: '' };
  };
}

describe('pinned Basis CPU review decoder', () => {
  it('parses exact RGBA8 DX10 DDS base pixels and rejects malformed variants', () => {
    const info = inspectKtx2(makeKtx2({ width: 8, height: 4, levels: 2, transfer: 'linear' }));
    const valid = makeDds(info, [10, 20, 30, 40]);
    expect(parseBasisRgba32Dds(valid, info)).toEqual({ width: 8, height: 4, data: new Uint8Array(Array.from({ length: 8 * 4 * 4 }, (_, i) => [10, 20, 30, 40][i % 4]!)) });
    expect(() => parseBasisRgba32Dds(valid.subarray(0, valid.length - 1), info)).toThrow(/payload size/);
    expect(() => parseBasisRgba32Dds(new Uint8Array([...valid, 0]), info)).toThrow(/payload size/);

    const wrongTransfer = new Uint8Array(valid);
    new DataView(wrongTransfer.buffer).setUint32(128, 29, true);
    expect(() => parseBasisRgba32Dds(wrongTransfer, info)).toThrow(/header/);
    const wrongDimension = new Uint8Array(valid);
    new DataView(wrongDimension.buffer).setUint32(132, 4, true);
    expect(() => parseBasisRgba32Dds(wrongDimension, info)).toThrow(/header/);
    for (const [offset, value] of [[8, 0x2100f], [20, info.width * 4], [88, 0], [92, 0], [108, 0x1000], [140, 1]]) {
      const changed = new Uint8Array(valid);
      new DataView(changed.buffer).setUint32(offset!, value!, true);
      expect(() => parseBasisRgba32Dds(changed, info)).toThrow(/header/);
    }
    expect(() => parseBasisRgba32Dds(valid, { ...info, width: 4_194_304, levels: 1 })).toThrow(/bounded KTX2|header/);
  });

  it('decodes one image with pinned format arguments and hash-bound source/decoder receipts', async () => {
    const root = await tempRoot();
    const identity = await identityIn(root);
    const source = makeKtx2({ width: 8, height: 4, levels: 2, transfer: 'srgb', codec: 'uastc' });
    const calls: string[][] = [];
    const result = await decodeBasisKtxTextures([{ imageIndex: 3, bytes: source }], {
      identity,
      runner: decodeRunner(info => makeDds(info, [9, 8, 7, 6]), calls),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(['-version']);
    expect(calls[1]?.slice(0, 3)).toEqual(['-export_dds', 'RGBA32', '-file']);
    expect(calls[1]?.slice(-3)).toEqual(['-no_multithreading', '-max_threads', '1']);
    expect(calls[1]).toContain('-output_file');
    expect(result.images.get(3)).toEqual({ width: 8, height: 4, data: new Uint8Array(Array.from({ length: 8 * 4 * 4 }, (_, i) => [9, 8, 7, 6][i % 4]!)) });
    expect(result.evidence.schema).toBe('gds.review.basis_decode.v1');
    expect(result.evidence.processCount).toBe(2);
    expect(result.evidence.decoder).toMatchObject({ sha256: identity.sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT, output: 'rgba32-dx10-dds-v1' });
    expect(result.evidence.textures).toEqual([{
      imageIndex: 3,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      decodedSha256: createHash('sha256').update(new Uint8Array(Array.from({ length: 8 * 4 * 4 }, (_, i) => [9, 8, 7, 6][i % 4]!))).digest('hex'),
      width: 8,
      height: 4,
      levels: 2,
      codec: 'uastc',
      transfer: 'srgb',
      decodedBytes: makeDds(inspectKtx2(source)).byteLength - 148,
    }]);
  });

  it('preflights texture count, per-map pixels, aggregate pixels and bytes before any runner call', async () => {
    let calls = 0;
    const runner: BasisRunner = async () => { calls += 1; return { stdout: `Basis Universal ${BASIS_VERSION}`, stderr: '' }; };
    const identity = await identityIn(await tempRoot());
    const tiny = makeKtx2({ codec: 'etc1s' });
    const empty = await decodeBasisKtxTextures([], { identity, runner });
    expect(empty.evidence.processCount).toBe(0);
    expect(empty.evidence.textures).toEqual([]);
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: new Uint8Array() }], { runner })).rejects.toThrow();
    await expect(decodeBasisKtxTextures(Array.from({ length: 33 }, (_, imageIndex) => ({ imageIndex, bytes: tiny })), { runner })).rejects.toThrow(/at most 32/);
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: makeKtx2({ width: 4096, height: 1024, codec: 'etc1s' }) }], { runner })).rejects.toThrow(/4 million/);
    const largeMaps: BasisReviewTextureInput[] = [0, 1, 2, 3].map(imageIndex => ({ imageIndex, bytes: makeKtx2({ width: 2048, height: 1024, codec: 'etc1s' }) }));
    await expect(decodeBasisKtxTextures(largeMaps, { runner })).rejects.toThrow(/8 million total/);
    const largeInput = makeKtx2({ width: 4, height: 4, codec: 'etc1s' });
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: new Uint8Array(BASIS_REVIEW_LIMITS.maxCompressedBytes + 1).map((_, index) => index < 12 ? largeInput[index]! : 0) }], { runner })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('verifies the pinned executable bytes and reported version before transcoding', async () => {
    const root = await tempRoot();
    const identity = await identityIn(root);
    const source = makeKtx2();
    let calls = 0;
    const runner: BasisRunner = async (_executable, args) => {
      calls += 1;
      if (args[0] === '-version') return { stdout: 'Basis Universal v2.49', stderr: '' };
      throw new Error('transcode should not run after an unsupported version');
    };
    const changedIdentity = { ...identity, sha256: '0'.repeat(64) };
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity: changedIdentity, runner })).rejects.toThrow(/identity changed/);
    expect(calls).toBe(0);
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity, runner })).rejects.toThrow(/expected 2\.50/);
    expect(calls).toBe(1);
  });

  it('rejects unexpected roster, symlink output, changed source bytes, and deadline overrun', async () => {
    const root = await tempRoot();
    const identity = await identityIn(root);
    const source = makeKtx2();
    let calls = 0;
    const extraFileRunner = decodeRunner(info => makeDds(info), [], async cwd => { await fs.writeFile(path.join(cwd, 'extra.bin'), 'unexpected'); });
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity, runner: extraFileRunner })).rejects.toThrow(/roster/);

    const symlinkRunner = decodeRunner(() => new Uint8Array(), [], async (_cwd, _input, output) => {
      await fs.rm(output);
      await fs.symlink(path.join(root, 'outside.dds'), output);
      await fs.writeFile(path.join(root, 'outside.dds'), makeDds(inspectKtx2(source)));
    });
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity, runner: symlinkRunner })).rejects.toThrow(/regular DDS/);

    const changedInputRunner = decodeRunner(info => makeDds(info), [], async (_cwd, input) => {
      await fs.writeFile(input, new Uint8Array(source.length).fill(0xff));
    });
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity, runner: changedInputRunner })).rejects.toThrow(/changed its KTX2 input/);

    let virtualNow = 0;
    const slowVersion: BasisRunner = async (_executable, args) => {
      calls += 1;
      if (args[0] === '-version') { virtualNow = BASIS_REVIEW_LIMITS.timeoutMs + 1; return { stdout: `Basis Universal ${BASIS_VERSION}`, stderr: '' }; }
      return { stdout: '', stderr: '' };
    };
    await expect(decodeBasisKtxTextures([{ imageIndex: 0, bytes: source }], { identity, runner: slowVersion, now: () => virtualNow })).rejects.toThrow(/deadline/);
    expect(calls).toBe(1);
  });
});
