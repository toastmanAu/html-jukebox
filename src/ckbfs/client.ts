import * as ccc from '@ckb-ccc/core';
import { CKBFS_V3_TESTNET as V3 } from '../../config/ckbfs-v3';
import { invariant } from './errors';
export const PUDGE_GENESIS = '0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606';
export type ChainClient = Pick<ccc.Client, 'addressPrefix' | 'getHeaderByNumberNoCache' | 'getTransactionNoCache' | 'findCellsPagedNoCache' | 'getCellLiveNoCache'>;
export function createPudgeClient(url = 'https://testnet.ckb.dev/') {
  return new ccc.ClientPublicTestnet({ url, fallbacks: [] });
}
export async function assertPudge(client: ChainClient) {
  invariant(client.addressPrefix === 'ckt', 'WRONG_NETWORK', 'Mainnet writes are disabled. Connect JoyID on Pudge/testnet.');
  const genesis = await client.getHeaderByNumberNoCache(0);
  invariant(genesis?.hash === PUDGE_GENESIS, 'WRONG_NETWORK', 'RPC genesis does not match Pudge. Check the endpoint and wallet network.');
}
export function v3Script(typeId: string): ccc.Script {
  invariant(/^0x[\da-f]{64}$/i.test(typeId), 'INVALID_IDENTIFIER', 'V3 Type ID args must be exactly 32 bytes.');
  return ccc.Script.from({ codeHash: V3.codeHash, hashType: 'data1', args: typeId });
}
export async function committedTransaction(client: ChainClient, hash: ccc.Hex) {
  const response = await client.getTransactionNoCache(hash);
  invariant(response?.status === 'committed', 'TRANSACTION_NOT_COMMITTED', `Transaction ${hash} is ${response?.status ?? 'unavailable'}. Wait for confirmation and retry resolution.`);
  invariant(response.transaction.hash() === hash, 'TRANSACTION_HASH_MISMATCH', `RPC returned a different transaction for ${hash}.`);
  return response.transaction;
}
export async function findLiveV3(client: ChainClient, typeId: string): Promise<ccc.Cell> {
  const script = v3Script(typeId);
  const result = await client.findCellsPagedNoCache({ script, scriptType: 'type', scriptSearchMode: 'exact', withData: true }, 'asc', 2);
  invariant(result.cells.length === 1, result.cells.length ? 'AMBIGUOUS_CELL' : 'MISSING_CKBFS',
    `Expected one live V3 cell for ${typeId}; found ${result.cells.length}. Check the network, Type ID and indexer sync.`);
  const cell = await client.getCellLiveNoCache(result.cells[0].outPoint, true);
  invariant(cell && cell.cellOutput.type?.eq(script), 'CELL_CHANGED', 'The CKBFS cell changed during lookup. Resolve again.');
  return cell;
}
