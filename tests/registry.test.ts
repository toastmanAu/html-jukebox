import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { assertRegistryOwner, assertRegistryTransition, assertRegistryUnchanged, broadcastRegistry, decodeRegistry, encodeRegistry, findRegistry, prepareRegistryCreation, prepareRegistryRollback, prepareRegistryUpdate, registryScript, verifyRegistryCommit, type SignedRegistry } from '../src/registry/registry';
import { initialManifest, manifestBytes, nextManifest, type Manifest, type VerifiedManifest } from '../src/registry/manifest';
import { resolveV3 } from '../src/ckbfs/resolver';
import { PUDGE_GENESIS } from '../src/ckbfs/client';
import { lock, typeId } from './fixtures';
import { BUILTIN_TYPE_ID } from '../config/ckbfs-v3';
import { u32 } from '../src/ckbfs/codec';
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
function environment() {
  const transactions: ccc.Transaction[] = [];
  const funding = [1, 2, 3, 4].map(n => ccc.Cell.from({ outPoint: { txHash: `0x${String(n).repeat(64)}`, index: 0 }, cellOutput: { capacity: 200n * 100_000_000n, lock }, outputData: '0x' }));
  const latestCell = () => { const tx = transactions.at(-1)!; return ccc.Cell.from({ outPoint: { txHash: tx.hash(), index: 0 }, cellOutput: tx.outputs[0], outputData: tx.outputsData[0] }); };
  const client = {
    addressPrefix: 'ckt', getKnownScript: (script: ccc.KnownScript) => new ccc.ClientPublicTestnet().getKnownScript(script),
    getHeaderByNumberNoCache: vi.fn(async () => ({ hash: PUDGE_GENESIS })),
    getCell: vi.fn(async (point: ccc.OutPoint) => funding.find(c => c.outPoint.eq(point)) ?? latestCell()),
    getCellLiveNoCache: vi.fn(async () => latestCell()),
    findCellsPagedNoCache: vi.fn(async () => ({ cells: transactions.length ? [latestCell()] : [], lastCursor: '0x' })),
    getTransactionNoCache: vi.fn(async (hash: string) => { const tx = transactions.find(t => t.hash() === hash); return tx ? { transaction: tx, status: 'committed' } : undefined; }),
    sendTransaction: vi.fn(async (tx: ccc.Transaction) => { transactions.push(tx.clone()); return tx.hash(); }),
  } as unknown as ccc.Client;
  const signer = { client, signType: ccc.SignerSignType.JoyId, getRecommendedAddressObj: async () => ({ script: lock }), findCells: async function* () { yield* funding; },
    prepareTransaction: vi.fn(async (tx: ccc.Transaction) => { tx.setWitnessArgs(0, { lock: `0x${'00'.repeat(1000)}` }); return tx; }),
    signTransaction: vi.fn(async (tx: ccc.Transaction) => { tx.setWitnessArgs(0, { lock: `0x${'ab'.repeat(1000)}` }); return tx; }),
  } as unknown as ccc.Signer;
  const manifests = new Map<string, VerifiedManifest>();
  function addManifest(manifest: Manifest, id = typeId) { const bytes = manifestBytes(manifest); const v = { manifest, bytes, pointer: { typeId: id, contentHash: ccc.hashCkb(bytes) }, txHash: id }; manifests.set(id, v); return v; }
  vi.mocked(resolveV3).mockImplementation(async id => { const v = manifests.get(id)!; return { fileBytes: v.bytes, contentType: 'application/json', currentOutPoint: { txHash: v.txHash } } as Awaited<ReturnType<typeof resolveV3>>; });
  const initial = addManifest(initialManifest('2026-09-11T00:00:00.000Z'));
  const saved: SignedRegistry[] = []; const persist = vi.fn(async (r: SignedRegistry) => { saved.push(r); });
  return { client, signer, initial, addManifest, persist, saved, transactions };
}
beforeEach(() => vi.clearAllMocks());
describe('registry binary codec', () => {
  it('uses exact Molecule offsets and Uint64 including above JSON safe range', () => {
    const data = { version: 1 as const, revision: 9007199254740993n, manifestTypeId: typeId, manifestHash: typeId }; const bytes = encodeRegistry(data);
    expect(bytes.length).toBe(96); expect(ccc.hexFrom(bytes.subarray(0, 24))).toBe('0x600000001400000018000000200000004000000001000000');
    expect(decodeRegistry(bytes)).toEqual(data);
  });
  it('rejects unsupported schemas, malformed widths and zero revisions', () => {
    const bytes = encodeRegistry({ version: 1, revision: 1n, manifestTypeId: typeId, manifestHash: typeId });
    bytes.set(u32(2), 20); expect(() => decodeRegistry(bytes)).toThrow('UNSUPPORTED_REGISTRY_SCHEMA');
    bytes.set(u32(1), 20); bytes.fill(0, 24, 32); expect(() => decodeRegistry(bytes)).toThrow('INVALID_REGISTRY');
    expect(() => encodeRegistry({ version: 1, revision: 1n << 64n, manifestTypeId: typeId, manifestHash: typeId })).toThrow('INVALID_REGISTRY');
  });
});
describe('owner-controlled Type ID transitions', () => {
  it('creates the built-in singleton, persists before broadcast and re-queries exact state', async () => {
    const e = environment(); const p = await prepareRegistryCreation(e.signer, e.initial.pointer);
    expect(p.typeId).toBe(ccc.hashTypeId(p.transaction.inputs[0], 0)); expect(p.transaction.outputs[0].type!.codeHash).toBe(BUILTIN_TYPE_ID.codeHash);
    expect(p.transaction.cellDeps).toHaveLength(0); // Test signer needs no deps; Type ID must add none.
    await broadcastRegistry(p, e.signer, e.persist);
    expect(e.persist.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(e.client.sendTransaction).mock.invocationCallOrder[0]);
    const verified = await verifyRegistryCommit(e.saved[0], e.client); expect(verified.registry.data.revision).toBe(1n); expect(verified.manifest.pointer).toEqual(e.initial.pointer);
  });
  it('preserves the exact Type ID and owner lock on update; rollback increments registry revision', async () => {
    const e = environment(); const create = await prepareRegistryCreation(e.signer, e.initial.pointer); await broadcastRegistry(create, e.signer, e.persist);
    const previous = await findRegistry(create.typeId, e.client);
    const next = e.addManifest(nextManifest(e.initial, 1n, []), `0x${'44'.repeat(32)}`);
    const update = await prepareRegistryUpdate(e.signer, previous, next.pointer);
    expect(update.transaction.outputs[0].type!.eq(registryScript(create.typeId))).toBe(true); expect(update.transaction.outputs[0].lock.eq(lock)).toBe(true);
    await broadcastRegistry(update, e.signer, e.persist); const updated = await findRegistry(create.typeId, e.client); expect(updated.data.revision).toBe(2n);
    const rollback = await prepareRegistryRollback(e.signer, updated, e.initial.pointer); expect(rollback.data.revision).toBe(3n); expect(rollback.data.manifestTypeId).toBe(e.initial.pointer.typeId);
    await broadcastRegistry(rollback, e.signer, e.persist); expect((await verifyRegistryCommit(e.saved[2], e.client)).manifest.manifest.revision).toBe(1);
  });
  it('rejects deletion, changed owner lock and duplicate registry outputs', async () => {
    const e = environment(); const p = await prepareRegistryCreation(e.signer, e.initial.pointer);
    const deleted = p.transaction.clone(); deleted.outputs.shift(); deleted.outputsData.shift(); expect(() => assertRegistryTransition(deleted, p)).toThrow('INVALID_REGISTRY_TRANSITION');
    const duplicate = p.transaction.clone(); duplicate.addOutput(duplicate.outputs[0], duplicate.outputsData[0]); expect(() => assertRegistryTransition(duplicate, p)).toThrow('INVALID_REGISTRY_TRANSITION');
    const changed = p.transaction.clone(); changed.outputs[0].lock.args = '0xab'; expect(() => assertRegistryTransition(changed, p)).toThrow('INVALID_REGISTRY_TRANSITION');
  });
  it('rejects wrong owner, wallet and network before signature', async () => {
    const e = environment(); const p = await prepareRegistryCreation(e.signer, e.initial.pointer); await broadcastRegistry(p, e.signer, e.persist); const state = await findRegistry(p.typeId, e.client);
    state.cell.cellOutput.lock = ccc.Script.from({ ...lock, args: '0xab' }); await expect(assertRegistryOwner(e.signer, state)).rejects.toThrow('OWNER_LOCK_MISMATCH');
    Object.defineProperty(e.signer, 'signType', { value: ccc.SignerSignType.Unknown }); await expect(assertRegistryOwner(e.signer)).rejects.toThrow('UNSUPPORTED_WALLET');
    Object.defineProperty(e.client, 'addressPrefix', { value: 'ckb' }); await expect(assertRegistryOwner(e.signer)).rejects.toThrow('WRONG_NETWORK');
  });
  it('rejects stale preparation if the registry changed before signing', async () => {
    const e = environment(); const p = await prepareRegistryCreation(e.signer, e.initial.pointer); await broadcastRegistry(p, e.signer, e.persist); const old = await findRegistry(p.typeId, e.client);
    const next = e.addManifest(nextManifest(e.initial, 1n, []), `0x${'44'.repeat(32)}`); const update = await prepareRegistryUpdate(e.signer, old, next.pointer);
    await broadcastRegistry(update, e.signer, e.persist); const count = vi.mocked(e.signer.signTransaction).mock.calls.length;
    await expect(assertRegistryUnchanged(old, e.client)).rejects.toThrow('REGISTRY_CHANGED');
    await expect(broadcastRegistry(update, e.signer, e.persist)).rejects.toThrow('REGISTRY_CHANGED'); expect(e.signer.signTransaction).toHaveBeenCalledTimes(count);
  });
  it('blocks broadcast on persistence failure and rejects invalid manifest history', async () => {
    const e = environment(); const p = await prepareRegistryCreation(e.signer, e.initial.pointer);
    await expect(broadcastRegistry(p, e.signer, async () => { throw new Error('disk full'); })).rejects.toThrow('disk full'); expect(e.client.sendTransaction).not.toHaveBeenCalled();
    await broadcastRegistry(p, e.signer, e.persist); const state = await findRegistry(p.typeId, e.client);
    await expect(prepareRegistryUpdate(e.signer, state, e.initial.pointer)).rejects.toThrow('INVALID_MANIFEST_HISTORY');
  });
});
