import * as ccc from '@ckb-ccc/core';
import { CKBFS_V3_TESTNET as V3 } from '../../config/ckbfs-v3';
import { adler32, decodeMetadata, encodeMetadata, encodeWitnesses, NO_BACKLINK, ZERO_HASH, type Backlink } from './codec';
import { assertPudge, findLiveV3, v3Script } from './client';
import { verifyV3Deployment } from './deployment';
import { resolveV3 } from './resolver';
import { invariant } from './errors';
export const MAX_TRANSACTION_BYTES = 100_000;
export interface PublishEstimate {
  capacity: string; fee: string; transactionBytes: number; bytes: number; chunkCount: number;
  maxTransactionBytes: number; feeRate: string; network: 'testnet';
}
export interface PublishResult extends PublishEstimate {
  typeId: ccc.Hex; txHash: ccc.Hex; outPoint: { txHash: ccc.Hex; index: '0x0' }; status: 'broadcast';
}
export type AppendResult = PublishResult;
export interface PublishOptions {
  content: Uint8Array; filename: string; contentType: string; signer: ccc.Signer;
  chunkBytes?: number; maxTransactionBytes?: number; feeRate?: bigint;
  /** Called before signing, with the final prepared transaction's capacity and fee. */
  beforeSign?: (estimate: PublishEstimate) => Promise<void>;
  /** Must durably persist the signed transaction BEFORE any broadcast. Throw to prevent broadcast. */
  persistSigned: (record: { txHash: ccc.Hex; typeId: ccc.Hex; transaction: ccc.Hex; estimate: PublishEstimate }) => Promise<void>;
}
export interface AppendOptions extends Omit<PublishOptions, 'filename' | 'contentType'> { identifier: string }
export interface PreparedV3 { transaction: ccc.Transaction; estimate: PublishEstimate; typeId: ccc.Hex; witnessStart: number }
function checkSize(tx: ccc.Transaction, max: number) {
  // Four bytes account for the serialized block transaction-vector offset, as CCC fee sizing does.
  const size = tx.toBytes().length + 4;
  invariant(size <= max, 'CONTENT_TOO_LARGE', `Serialized transaction is ${size} bytes; configured maximum is ${max}. No broadcast occurred. Publish a smaller initial segment and append using the same Type ID.`);
  return size;
}
export async function prepareV3(opts: Omit<PublishOptions, 'persistSigned'>, prior?: ccc.Cell): Promise<PreparedV3> {
  const { signer, content, filename, contentType, chunkBytes = 16 * 1024, feeRate = 2000n, maxTransactionBytes = MAX_TRANSACTION_BYTES } = opts;
  invariant(content instanceof Uint8Array, 'INVALID_CONTENT', 'Content must be a Uint8Array.');
  invariant(Number.isSafeInteger(maxTransactionBytes) && maxTransactionBytes > 0 && maxTransactionBytes <= MAX_TRANSACTION_BYTES, 'INVALID_LIMIT', `Transaction maximum must be at most ${MAX_TRANSACTION_BYTES} bytes.`);
  invariant(feeRate > 0n && feeRate <= 100_000n, 'INVALID_FEE_RATE', 'Fee rate must be between 1 and 100000 shannons/kB.');
  await verifyV3Deployment(signer.client);
  const lock = (await signer.getRecommendedAddressObj()).script;
  invariant(!prior || prior.cellOutput.lock.eq(lock), 'OWNER_LOCK_MISMATCH', 'Connected recommended lock does not own this CKBFS file.');
  const old = prior ? decodeMetadata(ccc.bytesFrom(prior.outputData)) : undefined;
  const previous: Backlink = prior && old ? { previousTxHash: prior.outPoint.txHash, previousWitnessIndex: old.index, previousChecksum: old.checksum } : NO_BACKLINK;
  const checksum = adler32(content, old?.checksum ?? 1);
  const makeData = (index: number) => ccc.hexFrom(encodeMetadata({ index, checksum, filename: old?.filename ?? filename, contentType: old?.contentType ?? contentType }));
  const type = prior?.cellOutput.type ?? v3Script(ZERO_HASH);
  const data = makeData(1);
  const capacity = BigInt(8 + lock.occupiedSize + type.occupiedSize + ccc.bytesFrom(data).length) * 100_000_000n;
  const tx = ccc.Transaction.from({
    inputs: prior ? [{ previousOutput: prior.outPoint, since: 0 }] : [],
    outputs: [{ capacity: prior && prior.cellOutput.capacity > capacity ? prior.cellOutput.capacity : capacity, lock, type }],
    outputsData: [data], cellDeps: [{ outPoint: { txHash: V3.depGroupTxHash, index: 0 }, depType: 'depGroup' }],
  });
  // Reject clearly oversized serialized content before collection. The final check includes wallet witnesses/deps/change.
  const probe = tx.clone(); probe.witnesses = ['0x', ...encodeWitnesses(content, 1, chunkBytes, previous)];
  checkSize(probe, maxTransactionBytes);
  // Reserve a minimum change cell plus a full maximum-sized transaction fee before freezing witness indexes.
  const reserve = BigInt(8 + lock.occupiedSize) * 100_000_000n + (BigInt(maxTransactionBytes) * feeRate + 999n) / 1000n;
  await tx.completeInputsByCapacity(signer, reserve);
  invariant(tx.inputs.length > 0, 'MISSING_INPUT', 'A signer input is required to derive Type ID.');
  const witnessStart = tx.inputs.length;
  const typeId = prior ? type.args : ccc.hashTypeId(tx.inputs[0], 0);
  tx.outputs[0].type = v3Script(typeId);
  tx.outputsData[0] = makeData(witnessStart);
  const contentWitnesses = encodeWitnesses(content, witnessStart, chunkBytes, previous);
  tx.witnesses = [...Array.from({ length: witnessStart }, () => '0x' as ccc.Hex), ...contentWitnesses];
  const inputIds = tx.inputs.map(i => ccc.hexFrom(i.toBytes())).join();
  await tx.completeFeeChangeToLock(signer, lock, feeRate, undefined, { shouldAddInputs: false });
  invariant(inputIds === tx.inputs.map(i => ccc.hexFrom(i.toBytes())).join(), 'WITNESS_INDEX_CHANGED', 'Wallet preparation changed transaction inputs. Rebuild before signing.');
  invariant(contentWitnesses.every((w, i) => tx.witnesses[witnessStart + i] === w), 'WITNESS_INDEX_CHANGED', 'Wallet preparation changed CKBFS witnesses.');
  invariant(tx.outputs[0].lock.eq(lock) && tx.outputs[0].type?.eq(v3Script(typeId)) && tx.outputsData[0] === makeData(witnessStart),
    'TRANSACTION_CHANGED', 'Wallet preparation changed the CKBFS output. Nothing was signed.');
  const transactionBytes = checkSize(tx, maxTransactionBytes);
  return { transaction: tx, typeId, witnessStart, estimate: { capacity: tx.outputs[0].capacity.toString(), fee: (await tx.getFee(signer.client)).toString(), transactionBytes,
    bytes: content.length, chunkCount: contentWitnesses.length, maxTransactionBytes, feeRate: feeRate.toString(), network: 'testnet' } };
}
export async function estimateV3Publish(content: Uint8Array, lock: ccc.ScriptLike, opts: Omit<PublishOptions, 'content' | 'persistSigned'>): Promise<PublishEstimate> {
  invariant(ccc.Script.from(lock).eq((await opts.signer.getRecommendedAddressObj()).script), 'OWNER_LOCK_MISMATCH', 'Estimate lock must match the connected signer.');
  return (await prepareV3({ ...opts, content })).estimate;
}
export async function broadcastPreparedV3(prepared: PreparedV3, opts: Pick<PublishOptions, 'signer' | 'persistSigned' | 'beforeSign'>): Promise<PublishResult> {
  const { transaction, estimate, typeId, witnessStart } = prepared;
  await assertPudge(opts.signer.client);
  await opts.beforeSign?.(estimate);
  const signed = await opts.signer.signTransaction(transaction.clone());
  invariant(signed.hash() === transaction.hash(), 'TRANSACTION_CHANGED', 'Wallet changed raw transaction during signing. Nothing was broadcast.');
  invariant(signed.witnesses.length === transaction.witnesses.length && transaction.witnesses.slice(witnessStart).every((w, i) => signed.witnesses[witnessStart + i] === w),
    'WITNESS_INDEX_CHANGED', 'Wallet changed CKBFS witnesses during signing. Nothing was broadcast.');
  checkSize(signed, estimate.maxTransactionBytes);
  invariant((await signed.getFee(opts.signer.client)) >= signed.estimateFee(BigInt(estimate.feeRate)),
    'INSUFFICIENT_FINAL_FEE', 'Signed transaction grew beyond its reserved fee. Rebuild before broadcasting.');
  const txHash = signed.hash();
  await opts.persistSigned({ txHash, typeId, transaction: ccc.hexFrom(signed.toBytes()), estimate });
  const returned = await opts.signer.client.sendTransaction(signed);
  invariant(returned === txHash, 'TRANSACTION_HASH_MISMATCH', 'Broadcast RPC returned a different hash. Re-query the persisted transaction before retrying.');
  return { ...estimate, txHash, typeId, outPoint: { txHash, index: '0x0' }, status: 'broadcast' };
}
export async function publishV3(opts: PublishOptions): Promise<PublishResult> {
  return broadcastPreparedV3(await prepareV3(opts), opts);
}
export async function appendV3(opts: AppendOptions): Promise<AppendResult> {
  const resolved = await resolveV3(opts.identifier, { client: opts.signer.client });
  const prior = await findLiveV3(opts.signer.client, resolved.typeId);
  invariant(prior.outPoint.txHash === resolved.currentOutPoint.txHash && ccc.numToHex(prior.outPoint.index) === resolved.currentOutPoint.index,
    'CELL_CHANGED', 'File changed while preparing append. Resolve again before signing.');
  const prepared = await prepareV3({ ...opts, filename: resolved.filename, contentType: resolved.contentType }, prior);
  return broadcastPreparedV3(prepared, opts);
}
