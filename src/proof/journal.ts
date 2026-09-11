import { openDB } from 'idb';
import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { assertPudge, v3Script, createPudgeClient } from '../ckbfs/client';
import { resolveV3 } from '../ckbfs/resolver';
import { invariant } from '../ckbfs/errors';
const hash = z.string().regex(/^0x[\da-f]{64}$/);
export const proofKinds = ['small', 'multi', 'append-1', 'append-2', 'empty'] as const;
export type ProofKind = typeof proofKinds[number];
const recordSchema = z.object({
  id: z.enum(proofKinds), typeId: hash, txHash: hash, signedTransaction: z.string().regex(/^0x(?:[\da-f]{2})+$/),
  expectedBytes: z.string().regex(/^0x(?:[\da-f]{2})*$/), expectedHash: hash,
  ownerLockHash: hash, status: z.enum(['signed', 'broadcast', 'verified']), updatedAt: z.string(),
});
export type ProofRecord = z.infer<typeof recordSchema>;
export async function proofDB() {
  return openDB('ckbfs-jukebox-v1', 1, { upgrade(db) {
    for (const name of ['manifests', 'demos', 'preferences', 'adminDrafts']) db.createObjectStore(name);
  } });
}
export async function records(): Promise<ProofRecord[]> {
  const db = await proofDB(); const raw = await db.get('adminDrafts', 'phase-1-proof') ?? [];
  return z.array(recordSchema).parse(raw);
}
export async function saveRecord(record: ProofRecord) {
  const parsed = recordSchema.parse(record);
  const db = await proofDB(); const tx = db.transaction('adminDrafts', 'readwrite');
  const current = z.array(recordSchema).parse(await tx.store.get('phase-1-proof') ?? []);
  const prior = current.find(r => r.id === parsed.id);
  invariant(!prior || prior.txHash === parsed.txHash, 'DUPLICATE_UPLOAD_BLOCKED', 'This proof already has a signed transaction. Recover it instead of uploading again.');
  await tx.store.put([...current.filter(r => r.id !== parsed.id), parsed], 'phase-1-proof'); await tx.done;
}
export function validatedSignedTransaction(record: ProofRecord) {
  recordSchema.parse(record);
  const tx = ccc.Transaction.fromBytes(record.signedTransaction);
  invariant(tx.hash() === record.txHash && tx.outputs[0].type?.eq(v3Script(record.typeId)) && tx.outputs[0].lock.hash() === record.ownerLockHash,
    'DRAFT_CORRUPT', 'Persisted transaction does not match its hash/Type ID. Do not broadcast.');
  invariant(ccc.hashCkb(ccc.bytesFrom(record.expectedBytes)) === record.expectedHash, 'DRAFT_CORRUPT', 'Persisted expected bytes do not match their hash.');
  return tx;
}
export async function verifyRecord(record: ProofRecord): Promise<ProofRecord> {
  validatedSignedTransaction(record);
  // Fresh client: never resolve from CCC's just-broadcast transaction cache.
  const resolved = await resolveV3(record.typeId, { client: createPudgeClient() });
  const expected = ccc.bytesFrom(record.expectedBytes);
  invariant(resolved.fileBytes.length === expected.length && resolved.fileBytes.every((b, i) => b === expected[i]),
    'BYTE_MISMATCH', 'Independently resolved bytes differ from the exact published fixture.');
  invariant(ccc.hashCkb(resolved.fileBytes) === record.expectedHash, 'HASH_MISMATCH', 'Cryptographic content hash differs from the expected fixture.');
  invariant(resolved.currentOutPoint.txHash === record.txHash, 'CELL_CHANGED', 'Live state is newer than this proof transaction. Verify the latest append proof.');
  const result = { ...record, status: 'verified' as const, updatedAt: new Date().toISOString() }; await saveRecord(result); return result;
}
export async function rebroadcastRecord(record: ProofRecord, client: ccc.Client) {
  await assertPudge(client);
  const tx = validatedSignedTransaction(record);
  const current = await client.getTransactionNoCache(record.txHash);
  if (current?.status === 'committed' || current?.status === 'pending' || current?.status === 'proposed') return current.status;
  // Broadcast exactly the persisted transaction, never rebuild or re-sign an uncertain upload.
  const returned = await client.sendTransaction(tx);
  invariant(returned === record.txHash, 'TRANSACTION_HASH_MISMATCH', 'Unexpected RPC broadcast result.');
  await saveRecord({ ...record, status: 'broadcast', updatedAt: new Date().toISOString() });
  return 'broadcast';
}
