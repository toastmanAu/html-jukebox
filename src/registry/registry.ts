import * as ccc from '@ckb-ccc/core';
import { BUILTIN_TYPE_ID } from '../../config/ckbfs-v3';
import { decodeTable, encodeTable, readU32, u32, ZERO_HASH } from '../ckbfs/codec';
import { assertPudge, committedTransaction, type ChainClient } from '../ckbfs/client';
import { invariant } from '../ckbfs/errors';
import { MAX_TRANSACTION_BYTES } from '../ckbfs/publisher';
import { byte32Schema, resolveManifest, findManifestAncestor, type ManifestPointer, type VerifiedManifest } from './manifest';
export interface RegistryData { version: 1; revision: bigint; manifestTypeId: string; manifestHash: string }
export interface RegistryState { typeId: string; cell: ccc.Cell; data: RegistryData }
export interface RegistryEstimate { operation: 'create' | 'update' | 'rollback'; revision: string; capacity: string; fee: string; transactionBytes: number; network: 'testnet'; manifestTypeId: string; manifestHash: string }
export interface PreparedRegistry { transaction: ccc.Transaction; typeId: string; previous?: RegistryState; data: RegistryData; ownerLock: ccc.Script; estimate: RegistryEstimate }
export interface SignedRegistry { txHash: ccc.Hex; typeId: string; transaction: ccc.Hex; data: { version: 1; revision: string; manifestTypeId: string; manifestHash: string }; previousOutPoint?: { txHash: ccc.Hex; index: ccc.Hex } }
export function registryScript(typeId: string): ccc.Script { byte32Schema.parse(typeId); return ccc.Script.from({ ...BUILTIN_TYPE_ID, args: typeId }); }
export function encodeRegistry(data: RegistryData): Uint8Array {
  invariant(data.version === 1 && data.revision > 0n && data.revision <= 0xffffffffffffffffn, 'INVALID_REGISTRY', 'Registry version must be 1 with a positive Uint64 revision.');
  byte32Schema.parse(data.manifestTypeId); byte32Schema.parse(data.manifestHash);
  const revision = new Uint8Array(8); new DataView(revision.buffer).setBigUint64(0, data.revision, true);
  return encodeTable([u32(1), revision, ccc.bytesFrom(data.manifestTypeId), ccc.bytesFrom(data.manifestHash)]);
}
export function decodeRegistry(bytes: Uint8Array): RegistryData {
  const [version, revision, typeId, hash] = decodeTable(bytes, 4);
  invariant(version.length === 4 && revision.length === 8 && typeId.length === 32 && hash.length === 32, 'INVALID_REGISTRY', 'Registry fields must have exact Uint32/Uint64/Byte32 lengths.');
  invariant(readU32(version) === 1, 'UNSUPPORTED_REGISTRY_SCHEMA', 'Only registry schema 1 is supported.');
  const value = new DataView(revision.buffer, revision.byteOffset, 8).getBigUint64(0, true);
  invariant(value > 0n, 'INVALID_REGISTRY', 'Registry revision must be positive.');
  return { version: 1, revision: value, manifestTypeId: ccc.hexFrom(typeId), manifestHash: ccc.hexFrom(hash) };
}
export async function findRegistry(typeId: string, client: ChainClient): Promise<RegistryState> {
  await assertPudge(client); const script = registryScript(typeId);
  const found = await client.findCellsPagedNoCache({ script, scriptType: 'type', scriptSearchMode: 'exact', withData: true }, 'asc', 2);
  invariant(found.cells.length === 1, 'MISSING_REGISTRY', `Expected one live singleton registry; found ${found.cells.length}. Check Pudge, registry Type ID and indexer synchronization.`);
  const cell = await client.getCellLiveNoCache(found.cells[0].outPoint, true);
  invariant(cell && cell.cellOutput.type?.eq(script), 'REGISTRY_CHANGED', 'Registry changed during lookup. Reload it before preparing a transaction.');
  const tx = await committedTransaction(client, cell.outPoint.txHash); const index = Number(cell.outPoint.index);
  invariant(tx.outputs[index]?.type?.eq(script) && tx.outputsData[index] === cell.outputData && tx.outputs[index].lock.eq(cell.cellOutput.lock),
    'INVALID_REGISTRY', 'Live registry disagrees with its committed creating transaction.');
  return { typeId, cell, data: decodeRegistry(ccc.bytesFrom(cell.outputData)) };
}
export function registryPointer(state: RegistryState): ManifestPointer { return { typeId: state.data.manifestTypeId, contentHash: state.data.manifestHash }; }
export async function registryCatalog(typeId: string, client: ChainClient) {
  const registry = await findRegistry(typeId, client); const manifest = await resolveManifest(registryPointer(registry), client);
  invariant(BigInt(manifest.manifest.revision) <= registry.data.revision, 'INVALID_REGISTRY', 'Manifest revision exceeds the registry transition revision.');
  return { registry, manifest };
}
export async function assertRegistryOwner(signer: ccc.Signer, state?: RegistryState) {
  await assertPudge(signer.client);
  invariant(signer.signType === ccc.SignerSignType.JoyId, 'UNSUPPORTED_WALLET', 'Registry mutations require JoyID on Pudge.');
  const lock = (await signer.getRecommendedAddressObj()).script;
  invariant(!state || state.cell.cellOutput.lock.eq(lock), 'OWNER_LOCK_MISMATCH', 'Connected JoyID recommended lock does not match the registry owner lock.');
  return lock;
}
export async function assertRegistryUnchanged(previous: RegistryState, client: ChainClient) {
  const live = await findRegistry(previous.typeId, client);
  invariant(live.cell.outPoint.eq(previous.cell.outPoint) && live.cell.outputData === previous.cell.outputData && live.cell.cellOutput.lock.eq(previous.cell.cellOutput.lock),
    'REGISTRY_CHANGED', 'Registry changed underneath this transaction. Reload the catalog; preserve any already-published manifest for recovery.');
  return live;
}
export function assertRegistryTransition(tx: ccc.Transaction, prepared: Pick<PreparedRegistry, 'typeId' | 'data' | 'ownerLock' | 'previous'>) {
  const script = registryScript(prepared.typeId); const positions = tx.outputs.flatMap((o, i) => o.type?.eq(script) ? [i] : []);
  invariant(positions.length === 1 && positions[0] === 0, 'INVALID_REGISTRY_TRANSITION', 'Transaction must recreate exactly one registry output at index 0; deletion is forbidden.');
  invariant(tx.outputs[0].lock.eq(prepared.ownerLock) && tx.outputsData[0] === ccc.hexFrom(encodeRegistry(prepared.data)), 'INVALID_REGISTRY_TRANSITION', 'Registry owner lock or data changed unexpectedly.');
  if (prepared.previous) {
    invariant(prepared.previous.cell.cellOutput.type?.eq(script) && tx.inputs.filter(i => i.previousOutput.eq(prepared.previous!.cell.outPoint)).length === 1,
      'INVALID_REGISTRY_TRANSITION', 'Update must consume the exact previous singleton and preserve its Type ID.');
    invariant(prepared.data.revision === prepared.previous.data.revision + 1n, 'INVALID_REGISTRY_TRANSITION', 'Each registry transition must increment revision by one.');
  } else invariant(tx.inputs.length > 0 && ccc.hashTypeId(tx.inputs[0], 0) === prepared.typeId && prepared.data.revision === 1n,
    'INVALID_REGISTRY_TRANSITION', 'Creation must derive Type ID from the first input and initialize revision 1.');
}
async function buildRegistry(signer: ccc.Signer, target: VerifiedManifest, operation: RegistryEstimate['operation'], previous?: RegistryState): Promise<PreparedRegistry> {
  const ownerLock = await assertRegistryOwner(signer, previous);
  if (previous) await assertRegistryUnchanged(previous, signer.client);
  const revision = previous ? previous.data.revision + 1n : 1n;
  const data: RegistryData = { version: 1, revision, manifestTypeId: target.pointer.typeId, manifestHash: target.pointer.contentHash };
  const outputData = ccc.hexFrom(encodeRegistry(data));
  const provisional = registryScript(previous?.typeId ?? ZERO_HASH);
  const minCapacity = BigInt(8 + ownerLock.occupiedSize + provisional.occupiedSize + ccc.bytesFrom(outputData).length) * 100_000_000n;
  const capacity = previous && previous.cell.cellOutput.capacity > minCapacity ? previous.cell.cellOutput.capacity : minCapacity;
  const tx = ccc.Transaction.from({ inputs: previous ? [{ previousOutput: previous.cell.outPoint }] : [], outputs: [{ capacity, lock: ownerLock, type: provisional }], outputsData: [outputData] });
  // Built-in Type ID intentionally adds no cell dep. JoyID preparation supplies its own lock dependencies.
  const reserve = BigInt(8 + ownerLock.occupiedSize) * 100_000_000n + 200_000n;
  await tx.completeInputsByCapacity(signer, reserve);
  invariant(tx.inputs.length, 'MISSING_INPUT', 'Registry creation requires a signer input.');
  const typeId = previous?.typeId ?? ccc.hashTypeId(tx.inputs[0], 0);
  tx.outputs[0].type = registryScript(typeId);
  tx.witnesses = tx.inputs.map(() => '0x');
  const inputs = tx.inputs.map(i => ccc.hexFrom(i.toBytes())).join();
  await tx.completeFeeChangeToLock(signer, ownerLock, 2000n, undefined, { shouldAddInputs: false });
  invariant(inputs === tx.inputs.map(i => ccc.hexFrom(i.toBytes())).join(), 'TRANSACTION_CHANGED', 'Wallet preparation changed registry inputs. Rebuild before signing.');
  const transactionBytes = tx.toBytes().length + 4;
  invariant(transactionBytes <= MAX_TRANSACTION_BYTES, 'TRANSACTION_TOO_LARGE', 'Registry transaction exceeds the conservative size limit.');
  const prepared: PreparedRegistry = { transaction: tx, typeId, data, ownerLock, previous, estimate: { operation, revision: revision.toString(), capacity: capacity.toString(), fee: (await tx.getFee(signer.client)).toString(), transactionBytes, network: 'testnet', manifestTypeId: data.manifestTypeId, manifestHash: data.manifestHash } };
  assertRegistryTransition(tx, prepared); return prepared;
}
export async function prepareRegistryCreation(signer: ccc.Signer, pointer: ManifestPointer) {
  await assertRegistryOwner(signer);
  const target = await resolveManifest(pointer, signer.client);
  invariant(target.manifest.revision === 1 && !target.manifest.previous, 'INVALID_MANIFEST', 'Registry creation requires an independently verified initial manifest.');
  return buildRegistry(signer, target, 'create');
}
export async function prepareRegistryUpdate(signer: ccc.Signer, previous: RegistryState, pointer: ManifestPointer) {
  await assertRegistryOwner(signer, previous);
  const current = await resolveManifest(registryPointer(previous), signer.client);
  const target = await resolveManifest(pointer, signer.client);
  invariant(BigInt(target.manifest.revision) === previous.data.revision + 1n && target.manifest.previous?.typeId === current.pointer.typeId && target.manifest.previous.contentHash === current.pointer.contentHash && target.manifest.collection.id === current.manifest.collection.id,
    'INVALID_MANIFEST_HISTORY', 'New manifest must have registry revision N+1 and point back to the currently verified manifest.');
  return buildRegistry(signer, target, 'update', previous);
}
export async function prepareRegistryRollback(signer: ccc.Signer, previous: RegistryState, pointer: ManifestPointer) {
  await assertRegistryOwner(signer, previous);
  const current = await resolveManifest(registryPointer(previous), signer.client);
  const ancestor = await findManifestAncestor(current, pointer, signer.client);
  return buildRegistry(signer, ancestor, 'rollback', previous);
}
export async function broadcastRegistry(prepared: PreparedRegistry, signer: ccc.Signer, persistSigned: (record: SignedRegistry) => Promise<void>) {
  const owner = await assertRegistryOwner(signer, prepared.previous);
  invariant(owner.eq(prepared.ownerLock), 'OWNER_LOCK_MISMATCH', 'Connected JoyID changed after transaction preparation.');
  if (prepared.previous) await assertRegistryUnchanged(prepared.previous, signer.client);
  // Manifest integrity is independently rechecked immediately before the wallet request.
  await resolveManifest({ typeId: prepared.data.manifestTypeId, contentHash: prepared.data.manifestHash }, signer.client);
  assertRegistryTransition(prepared.transaction, prepared);
  const signed = await signer.signTransaction(prepared.transaction.clone());
  invariant(signed.hash() === prepared.transaction.hash(), 'TRANSACTION_CHANGED', 'Wallet changed the registry transaction. Nothing was broadcast.');
  assertRegistryTransition(signed, prepared);
  invariant(signed.toBytes().length + 4 <= MAX_TRANSACTION_BYTES && (await signed.getFee(signer.client)) >= signed.estimateFee(2000n), 'INVALID_FINAL_FEE', 'Signed transaction exceeds its reserved size or fee.');
  await assertRegistryOwner(signer, prepared.previous);
  if (prepared.previous) await assertRegistryUnchanged(prepared.previous, signer.client);
  const txHash = signed.hash();
  await persistSigned({ txHash, typeId: prepared.typeId, transaction: ccc.hexFrom(signed.toBytes()), data: { ...prepared.data, revision: prepared.data.revision.toString() },
    previousOutPoint: prepared.previous ? { txHash: prepared.previous.cell.outPoint.txHash, index: ccc.numToHex(prepared.previous.cell.outPoint.index) } : undefined });
  invariant(await signer.client.sendTransaction(signed) === txHash, 'TRANSACTION_HASH_MISMATCH', 'RPC returned an unexpected hash. Recover the persisted transaction.');
  return { txHash, typeId: prepared.typeId, status: 'broadcast' as const };
}
export async function verifyRegistryCommit(record: SignedRegistry, client: ChainClient) {
  const expected = ccc.Transaction.fromBytes(record.transaction);
  invariant(expected.hash() === record.txHash && expected.outputs[0]?.type?.eq(registryScript(record.typeId)), 'DRAFT_CORRUPT', 'Signed registry record disagrees with its hash or Type ID.');
  const state = await findRegistry(record.typeId, client);
  invariant(state.cell.outPoint.txHash === record.txHash && state.cell.outPoint.index === 0n && state.cell.outputData === expected.outputsData[0] && state.cell.cellOutput.lock.eq(expected.outputs[0].lock), 'REGISTRY_CHANGED', 'Live registry does not match this signed transition. Inspect current state before any retry.');
  const manifest = await resolveManifest(registryPointer(state), client);
  return { registry: state, manifest };
}
