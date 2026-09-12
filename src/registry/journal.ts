import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { proofDB } from '../proof/journal';
import { assertPudge, v3Script, type ChainClient } from '../ckbfs/client';
import { invariant } from '../ckbfs/errors';
import { byte32Schema, decodeManifest, resolveManifest } from './manifest';
import { decodeRegistry, findRegistry, registryScript, verifyRegistryCommit, type SignedRegistry } from './registry';
const hex = z.string().regex(/^0x(?:[\da-f]{2})*$/);
export const registryRecordSchema = z.object({
  id: z.string().min(1), kind: z.enum(['manifest', 'registry']), typeId: byte32Schema, txHash: byte32Schema, transaction: hex,
  content: hex.optional(), contentHash: byte32Schema.optional(), status: z.enum(['signed', 'broadcast', 'verified']),
  registryData: z.object({ version: z.literal(1), revision: z.string().regex(/^[1-9]\d*$/), manifestTypeId: byte32Schema, manifestHash: byte32Schema }).optional(),
  previousOutPoint: z.object({ txHash: byte32Schema, index: z.string().regex(/^0x[\da-f]+$/) }).optional(), updatedAt: z.string(),
});
export type RegistryRecord = z.infer<typeof registryRecordSchema>;
export async function registryRecords(): Promise<RegistryRecord[]> {
  return z.array(registryRecordSchema).parse(await (await proofDB()).get('adminDrafts', 'registry-transactions') ?? []);
}
export function checkRegistryRecord(record: RegistryRecord) {
  registryRecordSchema.parse(record); const tx = ccc.Transaction.fromBytes(record.transaction);
  invariant(tx.hash() === record.txHash, 'DRAFT_CORRUPT', 'Persisted transaction hash differs from its bytes.');
  if (record.kind === 'manifest') {
    invariant(record.content !== undefined && record.contentHash && tx.outputs[0]?.type?.eq(v3Script(record.typeId)), 'DRAFT_CORRUPT', 'Manifest draft lacks exact bytes/hash or V3 output.');
    decodeManifest(ccc.bytesFrom(record.content), record.contentHash);
  } else {
    invariant(record.registryData && tx.outputs[0]?.type?.eq(registryScript(record.typeId)), 'DRAFT_CORRUPT', 'Registry draft lacks data or built-in Type ID output.');
    const data = decodeRegistry(ccc.bytesFrom(tx.outputsData[0]));
    invariant(data.revision.toString() === record.registryData.revision && data.manifestTypeId === record.registryData.manifestTypeId && data.manifestHash === record.registryData.manifestHash,
      'DRAFT_CORRUPT', 'Persisted registry pointer disagrees with signed bytes.');
    if (record.previousOutPoint) invariant(tx.inputs.filter(i => i.previousOutput.eq(record.previousOutPoint!)).length === 1, 'DRAFT_CORRUPT', 'Recorded registry predecessor is not consumed by the transaction.');
  }
  return tx;
}
export async function saveRegistryRecord(record: RegistryRecord) {
  checkRegistryRecord(record);
  const tx = (await proofDB()).transaction('adminDrafts', 'readwrite');
  const all = z.array(registryRecordSchema).parse(await tx.store.get('registry-transactions') ?? []);
  const previous = all.find(r => r.id === record.id);
  invariant(!previous || previous.txHash === record.txHash, 'DUPLICATE_UPLOAD_BLOCKED', 'This operation already has a signed transaction. Recover the same transaction.');
  invariant(!previous || previous.status !== 'verified' || record.status === 'verified', 'INVALID_STAGE', 'A verified operation cannot regress.');
  await tx.store.put([...all.filter(r => r.id !== record.id), record], 'registry-transactions'); await tx.done;
}
export function asSignedRegistry(record: RegistryRecord): SignedRegistry {
  invariant(record.kind === 'registry' && record.registryData, 'INVALID_DRAFT', 'Expected a signed registry operation.');
  return { txHash: record.txHash as ccc.Hex, typeId: record.typeId, transaction: record.transaction as ccc.Hex, data: record.registryData,
    previousOutPoint: record.previousOutPoint ? { txHash: record.previousOutPoint.txHash as ccc.Hex, index: record.previousOutPoint.index as ccc.Hex } : undefined };
}
export async function verifyRegistryRecord(record: RegistryRecord, client: ChainClient) {
  checkRegistryRecord(record);
  if (record.kind === 'manifest') {
    const result = await resolveManifest({ typeId: record.typeId, contentHash: record.contentHash! }, client);
    invariant(result.txHash === record.txHash && ccc.hexFrom(result.bytes) === record.content, 'MANIFEST_HASH_MISMATCH', 'Independent manifest resolution differs from the signed operation.');
  } else await verifyRegistryCommit(asSignedRegistry(record), client);
  await saveRegistryRecord({ ...record, status: 'verified', updatedAt: new Date().toISOString() });
}
export async function recoverRegistryRecord(record: RegistryRecord, client: ccc.Client) {
  await assertPudge(client); const tx = checkRegistryRecord(record);
  const response = await client.getTransactionNoCache(record.txHash as ccc.Hex);
  if (record.kind === 'registry') {
    // Re-query the singleton before any retry, including uncertain broadcast responses.
    let current;
    try { current = await findRegistry(record.typeId, client); }
    catch (error) { if (!record.previousOutPoint && error instanceof Error && error.message.startsWith('MISSING_REGISTRY:')) current = undefined; else throw error; }
    if (current?.cell.outPoint.txHash === record.txHash) { await verifyRegistryRecord(record, client); return 'verified'; }
    invariant(!current || (record.previousOutPoint && current.cell.outPoint.eq(record.previousOutPoint)), 'REGISTRY_CHANGED', 'Another registry transition won. Keep the published manifest; rebuild only the registry step after reviewing current state.');
    if (record.previousOutPoint) invariant(current, 'MISSING_REGISTRY', 'Previous registry cell is not available. Wait for indexer synchronization; do not rebuild an upload.');
  }
  if (response?.status === 'committed' || response?.status === 'pending' || response?.status === 'proposed') return response.status;
  invariant(await client.sendTransaction(tx) === record.txHash, 'TRANSACTION_HASH_MISMATCH', 'RPC returned a different transaction hash.');
  await saveRegistryRecord({ ...record, status: 'broadcast', updatedAt: new Date().toISOString() }); return 'broadcast';
}
