/** Structural KTX fixture only. Payload is intentionally synthetic; use exclusively with mocked transcoding. */
export function syntheticKtx(options: { codec?: 'etc1s' | 'uastc'; width?: number; height?: number; linear?: boolean } = {}): Uint8Array {
  const codec = options.codec ?? 'uastc', width = options.width ?? 4, height = options.height ?? 4;
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const dfd = 80 + levels * 24, dfdLength = 44;
  const sgd = codec === 'etc1s' ? Math.ceil((dfd + dfdLength) / 8) * 8 : 0;
  const sgdLength = codec === 'etc1s' ? 20 + levels * 20 : 0;
  let position = Math.ceil((codec === 'etc1s' ? sgd + sgdLength : dfd + dfdLength) / 16) * 16;
  const records = [];
  for (let i = 0; i < levels; i++) { const bytes = codec === 'uastc' ? Math.ceil(Math.max(1, width >> i) / 4) * Math.ceil(Math.max(1, height >> i) / 4) * 16 : 8; records.push({ offset: position, length: bytes }); position += bytes; }
  const result = Buffer.alloc(position); result.set([0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a]);
  result.writeUInt32LE(1,16); result.writeUInt32LE(width,20); result.writeUInt32LE(height,24); result.writeUInt32LE(1,36); result.writeUInt32LE(levels,40); result.writeUInt32LE(codec === 'etc1s' ? 1 : 0,44);
  result.writeUInt32LE(dfd,48); result.writeUInt32LE(dfdLength,52); result.writeBigUInt64LE(BigInt(sgd),64); result.writeBigUInt64LE(BigInt(sgdLength),72);
  result.writeUInt32LE(dfdLength,dfd); result.writeUInt16LE(2,dfd+8); result.writeUInt16LE(dfdLength-4,dfd+10); result[dfd+12] = codec === 'etc1s' ? 163 : 166;
  result[dfd+13] = options.linear ? 0 : 1; result[dfd+14] = options.linear ? 1 : 2; result[dfd+16]=3; result[dfd+17]=3;
  result[dfd+20]=codec === 'uastc' ? 16 : 0; result[dfd+30]=127; result[dfd+31]=codec === 'uastc' ? 3 : 0; result.writeUInt32LE(0xffffffff,dfd+40);
  records.forEach((record,i) => { result.writeBigUInt64LE(BigInt(record.offset),80+i*24); result.writeBigUInt64LE(BigInt(record.length),88+i*24); result.writeBigUInt64LE(BigInt(codec === 'uastc' ? record.length : 0),96+i*24); });
  return result;
}
