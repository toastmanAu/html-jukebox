import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { proofDB } from '../src/proof/journal';
import { checkRegistryRecord, recoverRegistryRecord, registryRecords, saveRegistryRecord, verifyRegistryRecord, type RegistryRecord } from '../src/registry/journal';
import { encodeRegistry, findRegistry, registryScript, verifyRegistryCommit } from '../src/registry/registry';
import { resolveManifest, initialManifest, manifestBytes } from '../src/registry/manifest';
import { PUDGE_GENESIS } from '../src/ckbfs/client';
import { chainFixture, lock, typeId } from './fixtures';
vi.mock('../src/registry/registry', async original => ({ ...await original<typeof import('../src/registry/registry')>(), findRegistry: vi.fn(), verifyRegistryCommit: vi.fn() }));
vi.mock('../src/registry/manifest', async original => ({ ...await original<typeof import('../src/registry/manifest')>(), resolveManifest: vi.fn() }));
function manifestRecord(): RegistryRecord {
  const bytes = manifestBytes(initialManifest('2026-09-11T00:00:00.000Z')); const tx = chainFixture([bytes]).transactions[0];
  return { id: 'manifest-1', kind: 'manifest', typeId, txHash: tx.hash(), transaction: ccc.hexFrom(tx.toBytes()), content: ccc.hexFrom(bytes), contentHash: ccc.hashCkb(bytes), status: 'signed', updatedAt: new Date().toISOString() };
}
function registryRecord(): RegistryRecord {
  const data = { version: 1 as const, revision: 2n, manifestTypeId: typeId, manifestHash: typeId };
  const previousOutPoint = { txHash: `0x${'44'.repeat(32)}`, index: '0x0' };
  const tx = ccc.Transaction.from({ inputs: [{ previousOutput: previousOutPoint }], outputs: [{ capacity: 300n * 100_000_000n, lock, type: registryScript(typeId) }], outputsData: [ccc.hexFrom(encodeRegistry(data))] });
  return { id: 'registry-2', kind: 'registry', typeId, txHash: tx.hash(), transaction: ccc.hexFrom(tx.toBytes()), registryData: { ...data, revision: '2' }, previousOutPoint, status: 'signed', updatedAt: new Date().toISOString() };
}
function client(status?: string) {
  return { addressPrefix: 'ckt', getHeaderByNumberNoCache: async () => ({ hash: PUDGE_GENESIS }), getTransactionNoCache: vi.fn(async () => status ? { status } : undefined), sendTransaction: vi.fn(async (tx: ccc.Transaction) => tx.hash()) } as unknown as ccc.Client;
}
beforeEach(async () => { await (await proofDB()).clear('adminDrafts'); vi.clearAllMocks(); });
describe('manifest and registry post-broadcast recovery', () => {
  it('retains a successful manifest through later failure and blocks duplicate upload', async () => {
    const r = manifestRecord(); await saveRegistryRecord(r); await saveRegistryRecord({ ...r, status: 'verified' });
    expect((await registryRecords())[0].txHash).toBe(r.txHash);
    const other = { ...r, transaction: ccc.hexFrom(ccc.Transaction.fromBytes(r.transaction).toBytes()), txHash: `0x${'ff'.repeat(32)}` };
    expect(() => checkRegistryRecord(other)).toThrow('DRAFT_CORRUPT');
    await expect(saveRegistryRecord({ ...r, status: 'broadcast' })).rejects.toThrow('INVALID_STAGE');
  });
  it('rebroadcasts exact signed manifest bytes without a new signature', async () => {
    const r = manifestRecord(); await saveRegistryRecord(r); const c = client();
    expect(await recoverRegistryRecord(r, c)).toBe('broadcast');
    expect(ccc.hexFrom(ccc.Transaction.from(vi.mocked(c.sendTransaction).mock.calls[0][0]).toBytes())).toBe(r.transaction);
  });
  it('re-queries registry and recognizes an already committed transition without resend', async () => {
    const r = registryRecord(); await saveRegistryRecord(r); const c = client('committed');
    const tx = ccc.Transaction.fromBytes(r.transaction);
    vi.mocked(findRegistry).mockResolvedValue({ typeId, data: { version: 1, revision: 2n, manifestTypeId: typeId, manifestHash: typeId }, cell: ccc.Cell.from({ outPoint: { txHash: r.txHash, index: 0 }, cellOutput: tx.outputs[0], outputData: tx.outputsData[0] }) });
    expect(await recoverRegistryRecord(r, c)).toBe('verified'); expect(findRegistry).toHaveBeenCalled(); expect(verifyRegistryCommit).toHaveBeenCalled(); expect(c.sendTransaction).not.toHaveBeenCalled();
  });
  it('refuses to retry if another registry transition won', async () => {
    const r = registryRecord(); const c = client(); const tx = ccc.Transaction.fromBytes(r.transaction);
    vi.mocked(findRegistry).mockResolvedValue({ typeId, data: { version: 1, revision: 3n, manifestTypeId: typeId, manifestHash: typeId }, cell: ccc.Cell.from({ outPoint: { txHash: `0x${'55'.repeat(32)}`, index: 0 }, cellOutput: tx.outputs[0], outputData: tx.outputsData[0] }) });
    await expect(recoverRegistryRecord(r, c)).rejects.toThrow('REGISTRY_CHANGED'); expect(c.sendTransaction).not.toHaveBeenCalled();
  });
  it('verification failure preserves original signed manifest for another attempt', async () => {
    const r = manifestRecord(); await saveRegistryRecord(r); vi.mocked(resolveManifest).mockRejectedValue(new Error('MANIFEST_HASH_MISMATCH'));
    await expect(verifyRegistryRecord(r, client())).rejects.toThrow('MANIFEST_HASH_MISMATCH'); expect((await registryRecords())[0]).toEqual(r);
  });
});
