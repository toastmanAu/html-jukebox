import { bytesFrom, hexFrom, type Hex } from '@ckb-ccc/core';
import { invariant } from './errors';
export const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex;
export const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0; for (const p of parts) { out.set(p, pos); pos += p.length; } return out;
}
export function u32(n: number): Uint8Array {
  invariant(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, 'INVALID_U32', 'Expected an unsigned 32-bit integer.');
  const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, n, true); return out;
}
export function readU32(b: Uint8Array, offset = 0): number {
  invariant(offset >= 0 && offset + 4 <= b.length, 'INVALID_ENCODING', 'Truncated Uint32.');
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset, true);
}
export function adler32(bytes: Uint8Array, previous = 1): number {
  let a = previous & 0xffff, b = previous >>> 16;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
export function encodeTable(fields: Uint8Array[]): Uint8Array {
  let offset = 4 + 4 * fields.length;
  const offsets = fields.map(field => { const start = offset; offset += field.length; return u32(start); });
  return concat([u32(offset), ...offsets, ...fields]);
}
export function decodeTable(b: Uint8Array, count: number): Uint8Array[] {
  const header = 4 + count * 4;
  invariant(b.length >= header && readU32(b) === b.length && readU32(b, 4) === header,
    'INVALID_METADATA', 'Expected the exact V3 Molecule table; legacy V2 metadata is unsupported.');
  const offsets = Array.from({ length: count }, (_, i) => readU32(b, 4 + i * 4));
  offsets.push(b.length);
  return offsets.slice(0, -1).map((start, i) => {
    invariant(start >= header && start <= offsets[i + 1] && offsets[i + 1] <= b.length,
      'INVALID_METADATA', 'Molecule offsets are out of order or out of bounds.');
    return b.slice(start, offsets[i + 1]);
  });
}
export interface Metadata { index: number; checksum: number; contentType: string; filename: string }
export function encodeMetadata(m: Metadata): Uint8Array {
  const str = (s: string) => { const b = utf8.encode(s); return concat([u32(b.length), b]); };
  return encodeTable([u32(m.index), u32(m.checksum), str(m.contentType), str(m.filename)]);
}
export function decodeMetadata(b: Uint8Array): Metadata {
  const [i, c, ct, fn] = decodeTable(b, 4);
  invariant(i.length === 4 && c.length === 4, 'INVALID_METADATA', 'Index and checksum must each be four bytes.');
  const str = (s: Uint8Array) => {
    invariant(readU32(s) === s.length - 4, 'INVALID_METADATA', 'Molecule Bytes length mismatch.');
    try { return decoder.decode(s.subarray(4)); } catch { throw new Error('INVALID_METADATA: Invalid UTF-8 in metadata.'); }
  };
  return { index: readU32(i), checksum: readU32(c), contentType: str(ct), filename: str(fn) };
}
export interface Backlink { previousTxHash: Hex; previousWitnessIndex: number; previousChecksum: number }
export const NO_BACKLINK: Backlink = { previousTxHash: ZERO_HASH, previousWitnessIndex: 0, previousChecksum: 0 };
export function encodeHead(content: Uint8Array, nextIndex: number, previous: Backlink = NO_BACKLINK): Uint8Array {
  invariant(/^0x[0-9a-f]{64}$/i.test(previous.previousTxHash), 'INVALID_BACKLINK', 'Previous hash must be 32 bytes.');
  return concat([utf8.encode('CKBFS'), new Uint8Array([3]), bytesFrom(previous.previousTxHash),
    u32(previous.previousWitnessIndex), u32(previous.previousChecksum), u32(nextIndex), content]);
}
export function decodeHead(b: Uint8Array): Backlink & { nextIndex: number; content: Uint8Array } {
  invariant(b.length >= 50, 'INVALID_WITNESS', 'V3 head witness is shorter than 50 bytes.');
  invariant(hexFrom(b.subarray(0, 5)) === '0x434b424653', 'INVALID_MAGIC', 'Expected CKBFS head magic.');
  invariant(b[5] === 3, 'WRONG_VERSION', 'Only CKBFS V3 witness version 0x03 is supported.');
  const previousTxHash = hexFrom(b.subarray(6, 38));
  const previousWitnessIndex = readU32(b, 38), previousChecksum = readU32(b, 42);
  invariant(previousTxHash !== ZERO_HASH || (previousWitnessIndex === 0 && previousChecksum === 0),
    'INVALID_BACKLINK', 'An initial publish must have all-zero backlink fields.');
  return { previousTxHash, previousWitnessIndex, previousChecksum, nextIndex: readU32(b, 46), content: b.slice(50) };
}
export function encodeWitnesses(content: Uint8Array, start: number, chunkBytes = 16 * 1024, previous = NO_BACKLINK): Hex[] {
  invariant(Number.isInteger(chunkBytes) && chunkBytes > 0 && chunkBytes <= 64 * 1024,
    'INVALID_CHUNK_SIZE', 'Chunk size must be between 1 and 65536 bytes.');
  const count = Math.max(1, Math.ceil(content.length / chunkBytes));
  return Array.from({ length: count }, (_, i) => {
    const next = i + 1 === count ? 0 : start + i + 1;
    const bytes = content.slice(i * chunkBytes, (i + 1) * chunkBytes);
    return hexFrom(i === 0 ? encodeHead(bytes, next, previous) : concat([u32(next), bytes]));
  });
}
