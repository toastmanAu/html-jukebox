import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { prepareV3, publishV3, broadcastPreparedV3, appendV3, estimateV3Publish } from '../src/ckbfs/publisher';
import { decodeHead, decodeMetadata, utf8, ZERO_HASH } from '../src/ckbfs/codec';
import { resolveV3 } from '../src/ckbfs/resolver';
import { PUDGE_GENESIS } from '../src/ckbfs/client';
import { lock } from './fixtures';
vi.mock('../src/ckbfs/deployment', () => ({ verifyV3Deployment: vi.fn(async () => ({ verified: true })) }));
function environment() {
  const transactions: ccc.Transaction[] = [];
  const funding = [1, 2, 3].map(n => ccc.Cell.from({ outPoint: { txHash: `0x${String(n).repeat(64)}`, index: 0 }, cellOutput: { capacity: 200n * 100_000_000n, lock }, outputData: '0x' }));
  const latestCell = () => { const tx = transactions.at(-1)!; return ccc.Cell.from({ outPoint: { txHash: tx.hash(), index: 0 }, cellOutput: tx.outputs[0], outputData: tx.outputsData[0] }); };
  const client = {
    addressPrefix: 'ckt',
    getKnownScript: (script: ccc.KnownScript) => new ccc.ClientPublicTestnet().getKnownScript(script),
    getHeaderByNumberNoCache: vi.fn(async () => ({ hash: PUDGE_GENESIS })),
    getCell: vi.fn(async (point: ccc.OutPoint) => funding.find(c => c.outPoint.eq(point)) ?? latestCell()),
    getCellLiveNoCache: vi.fn(async () => latestCell()),
    findCellsPagedNoCache: vi.fn(async () => ({ cells: [latestCell()], lastCursor: '0x' })),
    getTransactionNoCache: vi.fn(async (hash: string) => { const tx = transactions.find(t => t.hash() === hash); return tx ? { transaction: tx, status: 'committed' } : undefined; }),
    sendTransaction: vi.fn(async (tx: ccc.Transaction) => { transactions.push(tx.clone()); return tx.hash(); }),
  } as unknown as ccc.Client;
  const signer = {
    client,
    getRecommendedAddressObj: async () => ({ script: lock }),
    findCells: async function* () { yield* funding; },
    prepareTransaction: vi.fn(async (tx: ccc.Transaction) => { tx.setWitnessArgs(0, { lock: `0x${'00'.repeat(1000)}` }); return tx; }),
    signTransaction: vi.fn(async (tx: ccc.Transaction) => { tx.setWitnessArgs(0, { lock: `0x${'ab'.repeat(1000)}` }); return tx; }),
  } as unknown as ccc.Signer;
  return { signer, client, transactions, latestCell };
}
const content = utf8.encode('<!doctype html><h1>V3 proof</h1>');
const options = () => ({ ...environment(), content, filename: 'proof.html', contentType: 'text/html', chunkBytes: 8, persistSigned: vi.fn(async () => {}) });
beforeEach(() => vi.clearAllMocks());
describe('real CCC transaction builder with offline signer/chain', () => {
  it('collects multiple inputs before witness placement; fees include complete witnesses', async () => {
    const o = options(); const p = await prepareV3(o);
    expect(p.transaction.inputs.length).toBeGreaterThan(1);
    const metadata = decodeMetadata(ccc.bytesFrom(p.transaction.outputsData[0]));
    expect(metadata.index).toBe(p.transaction.inputs.length);
    expect(decodeHead(ccc.bytesFrom(p.transaction.witnesses[metadata.index])).nextIndex).toBe(metadata.index + 1);
    expect(p.typeId).toBe(ccc.hashTypeId(p.transaction.inputs[0], 0));
    expect(p.transaction.outputs[0].type!.hashType).toBe('data1');
    expect(p.estimate.transactionBytes).toBe(p.transaction.toBytes().length + 4);
    expect(BigInt(p.estimate.fee)).toBe(p.transaction.estimateFee(2000n));
  });
  it('browser-native publisher resolves exact bytes independently', async () => {
    const o = options(); const result = await publishV3(o);
    expect((await resolveV3(result.typeId, o)).fileBytes).toEqual(content);
    expect(o.persistSigned).toHaveBeenCalledOnce();
    expect(o.persistSigned.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(o.client.sendTransaction).mock.invocationCallOrder[0]);
  });
  it('append preserves Type ID, consumes the prior cell and resolves cumulative bytes', async () => {
    const o = options(); const first = await publishV3(o);
    const addition = utf8.encode('<!-- append -->');
    const second = await appendV3({ ...o, identifier: first.typeId, content: addition });
    expect(second.typeId).toBe(first.typeId);
    const resolved = await resolveV3(first.typeId, o);
    expect(new TextDecoder().decode(resolved.fileBytes)).toBe(new TextDecoder().decode(content) + '<!-- append -->');
    expect(resolved.history).toHaveLength(2);
  });
  it('publishes empty content as one valid head', async () => {
    const o = options(); const result = await publishV3({ ...o, content: new Uint8Array() });
    expect(result.chunkCount).toBe(1); expect((await resolveV3(result.typeId, o)).size).toBe(0);
  });
  it('rejects oversized serialized transaction before signing', async () => {
    const o = options(); await expect(publishV3({ ...o, content: new Uint8Array(100_000), chunkBytes: 16_384 })).rejects.toThrow('CONTENT_TOO_LARGE');
    expect(o.signer.signTransaction).not.toHaveBeenCalled(); expect(o.client.sendTransaction).not.toHaveBeenCalled();
  });
  it('does not broadcast if durable persistence fails', async () => {
    const o = options(); o.persistSigned.mockRejectedValue(new Error('IndexedDB unavailable'));
    await expect(publishV3(o)).rejects.toThrow('IndexedDB unavailable'); expect(o.client.sendTransaction).not.toHaveBeenCalled();
  });
  it('rejects wallet mutation of witnesses or transaction', async () => {
    const o = options(); const p = await prepareV3(o);
    vi.mocked(o.signer.signTransaction).mockImplementation(async txLike => { const tx = ccc.Transaction.from(txLike); tx.witnesses[p.witnessStart] = '0x00'; return tx; });
    await expect(broadcastPreparedV3(p, o)).rejects.toThrow('WITNESS_INDEX_CHANGED');
    expect(o.client.sendTransaction).not.toHaveBeenCalled();
    vi.mocked(o.signer.signTransaction).mockImplementation(async txLike => { const tx = ccc.Transaction.from(txLike); tx.outputs[0].type!.args = ZERO_HASH; return tx; });
    await expect(broadcastPreparedV3(p, o)).rejects.toThrow('TRANSACTION_CHANGED');
  });
  it('rejects wrong lock for estimates', async () => {
    const o = options(); await expect(estimateV3Publish(content, { ...lock, args: '0xab' }, o)).rejects.toThrow('OWNER_LOCK_MISMATCH');
  });
});
