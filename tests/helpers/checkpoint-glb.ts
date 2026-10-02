/** Minimal GLB envelope for checkpoint hashing tests; geometry inspection is tested separately. */
export function checkpointGlb(fields: Record<string, unknown> = {}): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...fields }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}
