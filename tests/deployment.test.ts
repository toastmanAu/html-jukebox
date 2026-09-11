import { describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import snapshot from './deployment.fixture.json';
import { verifyV3Deployment } from '../src/ckbfs/deployment';
import { PUDGE_GENESIS, type ChainClient } from '../src/ckbfs/client';
import { CKBFS_V3_TESTNET as V3 } from '../config/ckbfs-v3';
function fixture() {
  const transactions = Object.fromEntries(Object.entries(snapshot).map(([hash, bytes]) => [hash, ccc.Transaction.fromBytes(bytes)]));
  return {
    addressPrefix: 'ckt',
    getHeaderByNumberNoCache: vi.fn(async () => ({ hash: PUDGE_GENESIS })),
    getTransactionNoCache: vi.fn(async (hash: string) => transactions[hash] ? { transaction: transactions[hash], status: 'committed' } : undefined),
    getCellLiveNoCache: vi.fn(async (point: { txHash: string; index: ccc.NumLike }) => {
      const tx = transactions[point.txHash]; const i = Number(point.index);
      return tx?.outputs[i] ? ccc.Cell.from({ outPoint: point, cellOutput: tx.outputs[i], outputData: tx.outputsData[i] }) : undefined;
    }),
  };
}
describe('deployment preflight against captured Pudge transactions', () => {
  it('verifies actual dep-group, code bytes and Type IDs', async () => {
    const result = await verifyV3Deployment(fixture() as unknown as ChainClient);
    expect(result.verified).toBe(true); expect(result.codeCells.map(c => c.dataHash)).toEqual([V3.codeHash, V3.adler32CodeHash]);
  });
  it('fails loudly for spent dep-group and code cells', async () => {
    const f = fixture(); f.getCellLiveNoCache.mockResolvedValue(undefined);
    await expect(verifyV3Deployment(f as unknown as ChainClient)).rejects.toThrow('DEPLOYMENT_MISMATCH');
    const g = fixture(); const original = g.getCellLiveNoCache.getMockImplementation()!;
    g.getCellLiveNoCache.mockImplementation(async point => point.txHash === V3.depGroupTxHash ? original(point) : undefined);
    await expect(verifyV3Deployment(g as unknown as ChainClient)).rejects.toThrow('Referenced code cell is spent');
  });
  it('rejects uncommitted deployment and altered code transaction', async () => {
    const f = fixture(); f.getTransactionNoCache.mockResolvedValue(undefined);
    await expect(verifyV3Deployment(f as unknown as ChainClient)).rejects.toThrow('TRANSACTION_NOT_COMMITTED');
    const g = fixture(); const original = g.getTransactionNoCache.getMockImplementation()!;
    g.getTransactionNoCache.mockImplementation(async hash => { const result = await original(hash); if (result && hash === V3.deployTxHash) result.transaction.outputsData[0] = '0x00'; return result; });
    await expect(verifyV3Deployment(g as unknown as ChainClient)).rejects.toThrow('TRANSACTION_HASH_MISMATCH');
  });
  it('checks genesis even when client claims a testnet prefix', async () => {
    const f = fixture(); f.getHeaderByNumberNoCache.mockResolvedValue({ hash: `0x${'00'.repeat(32)}` });
    await expect(verifyV3Deployment(f as unknown as ChainClient)).rejects.toThrow('WRONG_NETWORK');
  });
});
