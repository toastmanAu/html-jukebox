import { describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { concat, decodeMetadata, encodeMetadata, u32, utf8 } from '../src/ckbfs/codec';
import { resolveV3 } from '../src/ckbfs/resolver';
import { chainFixture, typeId } from './fixtures';
function editWitness(f: ReturnType<typeof chainFixture>, index: number, offset: number, value: Uint8Array) {
  const tx = f.transactions.at(-1)!;
  const b = ccc.bytesFrom(tx.witnesses[index]); b.set(value, offset); tx.witnesses[index] = ccc.hexFrom(b);
}
describe('V3 read/write fixture symmetry', () => {
  it.each([0, 1, 8, 73, 16000])('round trips %i bytes across witness links', async count => {
    const content = Uint8Array.from({ length: count }, (_, i) => i % 251);
    const f = chainFixture([content], count > 100 ? 127 : 4);
    const result = await resolveV3(typeId, f);
    expect(result.fileBytes).toEqual(content); expect(result.checksumValid).toBe(true);
    expect(result.history[0].chunkCount).toBe(Math.max(1, Math.ceil(count / (count > 100 ? 127 : 4))));
  });
  it.each([2, 4])('reconstructs %i segments oldest first and validates every backlink', async count => {
    const parts = Array.from({ length: count }, (_, i) => utf8.encode(`segment ${i}`));
    const f = chainFixture(parts);
    const result = await resolveV3(typeId, f);
    expect(result.fileBytes).toEqual(concat(parts)); expect(result.history).toHaveLength(count);
  });
  it('supports a head at index zero', async () => {
    const f = chainFixture([utf8.encode('zero head')], 4, 0);
    expect((await resolveV3(typeId, f)).fileBytes).toEqual(utf8.encode('zero head'));
  });
  it.each([
    ['INVALID_MAGIC', 1, 0, new Uint8Array([0])], ['WRONG_VERSION', 1, 5, new Uint8Array([2])],
    ['INVALID_WITNESS_INDEX', 1, 46, u32(999)], ['WITNESS_LOOP', 1, 46, u32(1)],
    ['CHECKSUM_MISMATCH', 2, 4, new Uint8Array([255])],
  ] as const)('rejects %s', async (code, index, offset, value) => {
    const f = chainFixture([utf8.encode('abcdefgh')]); editWitness(f, index, offset, value);
    await expect(resolveV3(typeId, f)).rejects.toThrow(code);
  });
  it('rejects a truncated continuation', async () => {
    const f = chainFixture([utf8.encode('abcdefgh')]); f.transactions[0].witnesses[2] = '0x01';
    await expect(resolveV3(typeId, f)).rejects.toThrow('INVALID_ENCODING');
  });
  it('rejects altered historical checksum', async () => {
    const f = chainFixture([utf8.encode('old'), utf8.encode('new')]); editWitness(f, 1, 42, u32(5));
    await expect(resolveV3(typeId, f)).rejects.toThrow('INVALID_WITNESS_CHAIN');
  });
  it('rejects an unconsumed backlink', async () => {
    const f = chainFixture([utf8.encode('old'), utf8.encode('new')]);
    f.transactions[1].inputs[0].previousOutput.index = 7n;
    await expect(resolveV3(typeId, f)).rejects.toThrow('did not consume');
  });
  it('rejects V2 script cells', async () => {
    const f = chainFixture([utf8.encode('x')]); f.transactions[0].outputs[0].type!.codeHash = `0x${'55'.repeat(32)}`;
    await expect(resolveV3(typeId, f)).rejects.toThrow('CELL_CHANGED');
  });
  it('rejects metadata checksum mismatch', async () => {
    const f = chainFixture([utf8.encode('x')]); const tx = f.transactions[0];
    tx.outputsData[0] = ccc.hexFrom(encodeMetadata({ ...decodeMetadata(ccc.bytesFrom(tx.outputsData[0])), checksum: 42 }));
    await expect(resolveV3(typeId, f)).rejects.toThrow('CHECKSUM_MISMATCH');
  });
  it('enforces history, byte and chunk budgets', async () => {
    const f = chainFixture([utf8.encode('abcdef'), utf8.encode('ghijk')]);
    await expect(resolveV3(typeId, { ...f, maxDepth: 1 })).rejects.toThrow('HISTORY_LIMIT');
    await expect(resolveV3(typeId, { ...f, maxBytes: 2 })).rejects.toThrow('RESOURCE_LIMIT');
    await expect(resolveV3(typeId, { ...f, maxChunks: 1 })).rejects.toThrow('RESOURCE_LIMIT');
  });
  it('refuses missing/uncommitted transactions and wrong networks', async () => {
    const f = chainFixture([utf8.encode('x')]);
    vi.mocked(f.client.getTransactionNoCache).mockResolvedValue(undefined);
    await expect(resolveV3(typeId, f)).rejects.toThrow('TRANSACTION_NOT_COMMITTED');
    Object.defineProperty(f.client, 'addressPrefix', { value: 'ckb' });
    await expect(resolveV3(typeId, f)).rejects.toThrow('WRONG_NETWORK');
  });
});
