import { describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { initialManifest, manifestBytes, decodeManifest, manifestSchema, nextManifest, findManifestAncestor, resolveManifest, type VerifiedManifest } from '../src/registry/manifest';
import { resolveV3 } from '../src/ckbfs/resolver';
import { chainFixture, typeId } from './fixtures';
import { CKBFS_PROTOCOL_V3 } from '../config/ckbfs-v3';
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
const initial = initialManifest('2026-09-11T00:00:00.000Z');
function verified(manifest = initial, id = typeId): VerifiedManifest {
  const bytes = manifestBytes(manifest); return { manifest, bytes, pointer: { typeId: id, contentHash: ccc.hashCkb(bytes) }, txHash: typeId };
}
const item = { id: 'example', title: 'Example', filename: 'example.html', bytes: 0, contentHash: typeId, ckbfs: { protocol: CKBFS_PROTOCOL_V3, typeId }, capabilities: { network: false, audio: false, fullscreen: true, pointerLock: false, geolocation: false, clipboard: false } };
describe('manifest integrity and history', () => {
  it('validates initial exact JSON bytes and rejects a cryptographic hash mismatch', () => {
    const v = verified(); expect(decodeManifest(v.bytes, v.pointer.contentHash)).toEqual(initial);
    const changed = new Uint8Array([...v.bytes, 32]); expect(() => decodeManifest(changed, v.pointer.contentHash)).toThrow('MANIFEST_HASH_MISMATCH');
  });
  it('rejects duplicate IDs, malformed hashes and missing capabilities', () => {
    expect(() => manifestSchema.parse({ ...initial, items: [item, item] })).toThrow('Duplicate item ID');
    expect(() => manifestSchema.parse({ ...initial, items: [{ ...item, contentHash: '0x1234' }] })).toThrow();
    expect(() => manifestSchema.parse({ ...initial, items: [{ ...item, capabilities: {} }] })).toThrow();
  });
  it('rejects unsupported schema, bad previous pointers and unsafe JSON revisions', () => {
    expect(() => manifestSchema.parse({ ...initial, schema: 2 })).toThrow();
    expect(() => manifestSchema.parse({ ...initial, revision: 2 })).toThrow('previous');
    expect(() => manifestSchema.parse({ ...initial, previous: { typeId, contentHash: typeId } })).toThrow('Initial manifest');
    expect(() => manifestSchema.parse({ ...initial, revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
  it('builds a new revision from registry revision, including after a rollback', () => {
    const next = nextManifest(verified(), 7n, [item]); expect(next.revision).toBe(8); expect(next.previous).toEqual(verified().pointer);
    expect(() => nextManifest(verified(), BigInt(Number.MAX_SAFE_INTEGER), [])).toThrow('REVISION_OVERFLOW');
  });
  it('preserves forward-compatible metadata while validating core fields', () => {
    const manifest = manifestSchema.parse({ ...initial, note: 'extension', items: [{ ...item, status: 'hidden', extra: 42 }] });
    expect(manifest.note).toBe('extension'); expect(manifest.items[0].status).toBe('hidden');
  });
  it('independently verifies every historical manifest before accepting a rollback target', async () => {
    const a = verified(); const b = verified(nextManifest(a, 1n, []), `0x${'44'.repeat(32)}`);
    const c = verified(nextManifest(b, 2n, []), `0x${'55'.repeat(32)}`);
    const files = new Map([a, b, c].map(v => [v.pointer.typeId, v]));
    vi.mocked(resolveV3).mockImplementation(async id => { const v = files.get(id)!; return { fileBytes: v.bytes, contentType: 'application/json', currentOutPoint: { txHash: typeId } } as Awaited<ReturnType<typeof resolveV3>>; });
    const client = chainFixture([new Uint8Array()]).client;
    expect((await findManifestAncestor(c, a.pointer, client)).pointer).toEqual(a.pointer);
    await expect(findManifestAncestor(c, { typeId: `0x${'66'.repeat(32)}`, contentHash: typeId }, client)).rejects.toThrow('ROLLBACK_NOT_ANCESTOR');
    await expect(findManifestAncestor(c, a.pointer, client, 1)).rejects.toThrow('MANIFEST_HISTORY_LIMIT');
    await expect(resolveManifest({ ...a.pointer, contentHash: typeId }, client)).rejects.toThrow('MANIFEST_HASH_MISMATCH');
  });
});
