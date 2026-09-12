import { CKBFSError, invariant } from '../ckbfs/errors';
import { assertPudge, v3Script, type ChainClient } from '../ckbfs/client';
import { resolveV3 } from '../ckbfs/resolver';
import type * as ccc from '@ckb-ccc/core';
/** Resolve only the signed receipt's committed head, never the still-live pre-append prefix. */
export async function resolveUploadedFile(receipt: { typeId: string; txHash: string }, client: ChainClient) {
  await assertPudge(client);
  const response = await client.getTransactionNoCache(receipt.txHash as ccc.Hex);
  invariant(response, 'TRANSACTION_UNAVAILABLE', `Signed transaction ${receipt.txHash} is not visible to this RPC yet. Your saved upload is retained. Use Recover known transaction to re-query or rebroadcast the same signed transaction; do not create a new draft.`);
  invariant(response.status !== 'rejected', 'TRANSACTION_REJECTED', `Pudge rejected transaction ${receipt.txHash}. Keep this draft and inspect its transaction before retrying. No new upload was started.`);
  invariant(response.status === 'committed', 'TRANSACTION_NOT_COMMITTED', `Transaction ${receipt.txHash} is ${response.status}. Wait for confirmation, then click Continue next safe step. Your signed upload is saved and will not be repeated.`);
  invariant(response.transaction.hash() === receipt.txHash, 'TRANSACTION_HASH_MISMATCH', 'RPC returned a different transaction for the saved upload.');
  invariant(response.transaction.outputs[0]?.type?.eq(v3Script(receipt.typeId)), 'DRAFT_CORRUPT', 'Signed upload does not create the recorded V3 Type ID at output zero.');
  async function expectedCellIsLive() {
    const cell = await client.getCellLiveNoCache({ txHash: receipt.txHash as ccc.Hex, index: 0 }, true);
    return cell?.cellOutput.type?.eq(v3Script(receipt.typeId));
  }
  function waiting(): never { throw new CKBFSError('INDEXER_SYNC_PENDING', `Transaction ${receipt.txHash} is committed and its file cell is live, but the indexer has not exposed that head yet. Wait briefly and click Continue next safe step again. No signature or repeat upload is needed.`); }
  try {
    const resolved = await resolveV3(receipt.typeId, { client });
    if (resolved.currentOutPoint.txHash !== receipt.txHash) {
      if (await expectedCellIsLive()) waiting();
      throw new CKBFSError('CELL_CHANGED', 'Resolved CKBFS head differs from this signed receipt and the expected output is no longer live. Keep the draft and inspect the newer transaction; no content comparison or upload was attempted.');
    }
    return resolved;
  } catch (error) {
    if (!(error instanceof CKBFSError) || error.code !== 'MISSING_CKBFS') throw error;
    if (await expectedCellIsLive()) waiting();
    throw error;
  }
}
