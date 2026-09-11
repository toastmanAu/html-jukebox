import * as ccc from '@ckb-ccc/core';
import { vi } from 'vitest';
import { adler32, encodeMetadata, encodeWitnesses, NO_BACKLINK, ZERO_HASH, type Backlink } from '../src/ckbfs/codec';
import { PUDGE_GENESIS, v3Script, type ChainClient } from '../src/ckbfs/client';
export const lock = ccc.Script.from({ codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` });
export const typeId = `0x${'33'.repeat(32)}` as ccc.Hex;
export function chainFixture(contents: Uint8Array[], chunkBytes = 4, start = 1) {
  const transactions: ccc.Transaction[] = [];
  let checksum = 1;
  for (const content of contents) {
    const previous = transactions.at(-1);
    const old = checksum;
    checksum = adler32(content, checksum);
    const backlink: Backlink = previous ? { previousTxHash: previous.hash(), previousWitnessIndex: start, previousChecksum: old } : NO_BACKLINK;
    transactions.push(ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: previous?.hash() ?? ZERO_HASH, index: 0 } }],
      outputs: [{ capacity: 500n * 100_000_000n, lock, type: v3Script(typeId) }],
      outputsData: [ccc.hexFrom(encodeMetadata({ index: start, checksum, filename: 'fixture.html', contentType: 'text/html' }))],
      witnesses: [...Array.from({ length: start }, () => '0x' as ccc.Hex), ...encodeWitnesses(content, start, chunkBytes, backlink)],
    }));
  }
  const latest = () => transactions.at(-1)!;
  const cell = () => ccc.Cell.from({ outPoint: { txHash: latest().hash(), index: 0 }, cellOutput: latest().outputs[0], outputData: latest().outputsData[0] });
  const client = {
    addressPrefix: 'ckt',
    getHeaderByNumberNoCache: vi.fn(async () => ({ hash: PUDGE_GENESIS })),
    getTransactionNoCache: vi.fn(async (hash: string) => { const tx = transactions.find(tx => tx.hash() === hash); return tx ? { transaction: tx, status: 'committed' } : undefined; }),
    findCellsPagedNoCache: vi.fn(async () => ({ cells: [cell()], lastCursor: '0x' })),
    getCellLiveNoCache: vi.fn(async () => cell()),
  } as unknown as ChainClient;
  return { transactions, client, cell };
}
