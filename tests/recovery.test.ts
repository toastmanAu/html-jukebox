import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { proofDB, rebroadcastRecord, records, saveRecord, validatedSignedTransaction, verifyRecord, type ProofRecord } from '../src/proof/journal';
import { resolveV3 } from '../src/ckbfs/resolver';
import { chainFixture, lock, typeId } from './fixtures';
import { PUDGE_GENESIS } from '../src/ckbfs/client';
import { utf8 } from '../src/ckbfs/codec';
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
const bytes = utf8.encode('proof');
function record(): ProofRecord {
  const tx = chainFixture([bytes]).transactions[0];
  return { id: 'small', txHash: tx.hash(), typeId, signedTransaction: ccc.hexFrom(tx.toBytes()), expectedBytes: ccc.hexFrom(bytes),
    expectedHash: ccc.hashCkb(bytes), ownerLockHash: lock.hash(), status: 'signed', updatedAt: new Date().toISOString() };
}
beforeEach(async () => { await (await proofDB()).clear('adminDrafts'); vi.clearAllMocks(); });
describe('post-signature crash recovery', () => {
  it('persists signed bytes across database reopen and blocks a replacement upload', async () => {
    const r = record(); await saveRecord(r);
    (await proofDB()).close(); expect(await records()).toEqual([r]);
    await expect(saveRecord({ ...r, txHash: `0x${'aa'.repeat(32)}` })).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
  });
  it('rebroadcasts byte-identical signed transaction after an uncertain send', async () => {
    const r = record(); await saveRecord(r);
    const client = { addressPrefix: 'ckt', getHeaderByNumberNoCache: async () => ({ hash: PUDGE_GENESIS }), getTransactionNoCache: vi.fn(async () => undefined), sendTransaction: vi.fn(async (tx: ccc.Transaction) => {
      expect(ccc.hexFrom(tx.toBytes())).toBe(r.signedTransaction); return r.txHash;
    }) } as unknown as ccc.Client;
    expect(await rebroadcastRecord(r, client)).toBe('broadcast'); expect((await records())[0].status).toBe('broadcast');
    expect(client.sendTransaction).toHaveBeenCalledOnce();
  });
  it.each(['committed', 'pending', 'proposed'])('does not resend %s transactions', async status => {
    const r = record(); const client = { addressPrefix: 'ckt', getHeaderByNumberNoCache: async () => ({ hash: PUDGE_GENESIS }), getTransactionNoCache: vi.fn(async () => ({ status })), sendTransaction: vi.fn() } as unknown as ccc.Client;
    expect(await rebroadcastRecord(r, client)).toBe(status); expect(client.sendTransaction).not.toHaveBeenCalled();
  });
  it('refuses corrupted recovery bytes before broadcasting', () => {
    const r = record(); expect(() => validatedSignedTransaction({ ...r, txHash: `0x${'aa'.repeat(32)}` })).toThrow('DRAFT_CORRUPT');
    expect(() => validatedSignedTransaction({ ...r, expectedHash: `0x${'aa'.repeat(32)}` })).toThrow('DRAFT_CORRUPT');
  });
  it('a verification failure retains the original transaction for retry', async () => {
    const r = record(); await saveRecord(r);
    vi.mocked(resolveV3).mockRejectedValue(new Error('RPC unavailable'));
    await expect(verifyRecord(r)).rejects.toThrow('RPC unavailable'); expect(await records()).toEqual([r]);
  });
});
