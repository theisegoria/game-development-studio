import { invalidState } from '../util/errors.js';
export const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;
export function isKtx2(bytes: Uint8Array): boolean { return KTX2_MAGIC.every((value, index) => bytes[index] === value); }
export interface Ktx2Info { width: number; height: number; levels: number; codec: 'etc1s' | 'uastc'; transfer: 'srgb' | 'linear'; primaries: number; bytes: number }
/** Structural, allocation-bounded glTF Basis profile validation. Payload transcoding is a separate check. */
export function inspectKtx2(bytes: Uint8Array): Ktx2Info {
  const reject = (message: string): never => { throw invalidState(`Invalid KTX2: ${message}`); };
  if (!isKtx2(bytes) || bytes.length < 104 || bytes.length > 128 * 1024 * 1024) reject('signature/size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const u64 = (at: number) => { const value = view.getBigUint64(at, true); if (value > BigInt(Number.MAX_SAFE_INTEGER)) reject('unsafe offset'); return Number(value); };
  const width = u32(20), height = u32(24), levels = u32(40), compression = u32(44);
  if (u32(12) !== 0 || u32(16) !== 1 || !width || !height || width > 8192 || height > 8192 || width * height > 16_777_216 || width % 4 || height % 4 || u32(28) !== 0 || u32(32) !== 0 || u32(36) !== 1) reject('unsupported dimensions, format, layers or faces');
  if (!levels || levels > 14 || levels > Math.floor(Math.log2(Math.max(width, height))) + 1 || 80 + levels * 24 > bytes.length) reject('mip count');
  const ranges: Array<{ start: number; end: number }> = [{ start: 0, end: 80 + levels * 24 }];
  const range = (start: number, length: number, alignment: number) => {
    if (!length || start % alignment || start < 80 || start + length > bytes.length || !Number.isSafeInteger(start + length)) reject('section bounds/alignment');
    if (ranges.some(r => start < r.end && start + length > r.start)) reject('overlapping sections');
    ranges.push({ start, end: start + length });
  };
  const dfd = u32(48), dfdLength = u32(52), kvd = u32(56), kvdLength = u32(60), sgd = u64(64), sgdLength = u64(72);
  range(dfd, dfdLength, 4);
  if (dfdLength < 44 || u32(dfd) !== dfdLength || u32(dfd + 4) !== 0 || view.getUint16(dfd + 8, true) !== 2 || view.getUint16(dfd + 10, true) !== dfdLength - 4 || (dfdLength - 28) % 16) reject('data format descriptor');
  const model = view.getUint8(dfd + 12), primaries = view.getUint8(dfd + 13), transfer = view.getUint8(dfd + 14), flags = view.getUint8(dfd + 15);
  if ((model !== 163 && model !== 166) || (transfer !== 1 && transfer !== 2) || flags !== 0 || (transfer === 2 ? primaries !== 1 : primaries !== 0)) reject('unsupported Basis codec/color metadata');
  if (view.getUint8(dfd + 16) !== 3 || view.getUint8(dfd + 17) !== 3 || view.getUint8(dfd + 18) !== 0 || view.getUint8(dfd + 19) !== 0) reject('block dimensions');
  if ((model === 163 && compression !== 1) || (model === 166 && compression !== 0 && compression !== 2)) reject('codec/supercompression mismatch');
  if (sgdLength) range(sgd, sgdLength, 8); else if (sgd !== 0) reject('empty global data offset');
  if (model === 163 && sgdLength < 20 + levels * 20) reject('missing ETC1S global data');
  if (model === 166 && sgdLength !== 0) reject('unexpected UASTC global data');
  if (kvdLength) {
    range(kvd, kvdLength, 4); let at = kvd; const keys = new Set<string>();
    while (at < kvd + kvdLength) {
      if (at + 4 > kvd + kvdLength) reject('metadata length');
      const length = u32(at); at += 4;
      if (!length || at + length > kvd + kvdLength) reject('metadata bounds');
      const entry = bytes.subarray(at, at + length); const zero = entry.indexOf(0); if (zero < 1) reject('metadata key');
      const key = Buffer.from(entry.subarray(0, zero)).toString('utf8'); const value = Buffer.from(entry.subarray(zero + 1)).toString('utf8').replace(/\0+$/, '');
      if (keys.has(key)) reject('duplicate metadata key'); keys.add(key);
      if ((key === 'KTXorientation' && value !== 'rd') || (key === 'KTXswizzle' && value !== 'rgba')) reject('non-glTF orientation/swizzle');
      at += Math.ceil(length / 4) * 4;
    }
    if (at !== kvd + kvdLength) reject('metadata padding');
  } else if (kvd !== 0) reject('empty metadata offset');
  for (let i = 0; i < levels; i++) {
    const offset = u64(80 + i * 24), length = u64(88 + i * 24), rawLength = u64(96 + i * 24);
    range(offset, length, compression === 0 ? 16 : 1);
    const expected = Math.ceil(Math.max(1, width >> i) / 4) * Math.ceil(Math.max(1, height >> i) / 4) * 16;
    if (model === 166 && (rawLength !== expected || (compression === 0 && length !== expected))) reject('UASTC level byte count');
    if (model === 163 && rawLength !== 0) reject('ETC1S uncompressed size must be zero');
  }
  return { width, height, levels, codec: model === 163 ? 'etc1s' : 'uastc', transfer: transfer === 2 ? 'srgb' : 'linear', primaries, bytes: bytes.length };
}
