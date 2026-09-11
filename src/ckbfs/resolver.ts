import * as ccc from '@ckb-ccc/core';
import { CKBFS_PROTOCOL_V3 } from '../../config/ckbfs-v3';
import { adler32, concat, decodeHead, decodeMetadata, readU32, ZERO_HASH } from './codec';
import { assertPudge, committedTransaction, findLiveV3, v3Script, type ChainClient } from './client';
import { parseCKBFSIdentifier } from './identifier';
import { invariant } from './errors';
export interface ResolvedCKBFSFile {
  protocol: typeof CKBFS_PROTOCOL_V3; network: 'testnet'; typeId: ccc.Hex;
  filename: string; contentType: string; fileBytes: Uint8Array; size: number;
  checksum: number; checksumValid: true; currentOutPoint: { txHash: ccc.Hex; index: ccc.Hex };
  history: { txHash: ccc.Hex; headWitnessIndex: number; chunkCount: number; byteLength: number }[];
}
export interface ResolveOptions { client: ChainClient; maxDepth?: number; maxChunks?: number; maxBytes?: number }
export async function resolveV3(identifier: string, opts: ResolveOptions): Promise<ResolvedCKBFSFile> {
  const { client, maxDepth = 128, maxChunks = 4096, maxBytes = 32 * 1024 * 1024 } = opts;
  for (const limit of [maxDepth, maxChunks, maxBytes]) invariant(Number.isSafeInteger(limit) && limit > 0, 'INVALID_LIMIT', 'Resolver limits must be positive integers.');
  await assertPudge(client);
  const parsed = parseCKBFSIdentifier(identifier);
  let typeId: ccc.Hex;
  if (parsed.kind === 'typeId') typeId = parsed.typeId;
  else {
    const cell = await client.getCellLiveNoCache({ txHash: parsed.txHash, index: parsed.index }, true);
    invariant(cell?.cellOutput.type, 'MISSING_CKBFS', 'Outpoint is missing, spent or has no type script. Use the stable Type ID for latest state.');
    typeId = cell.cellOutput.type.args;
    invariant(cell.cellOutput.type.eq(v3Script(typeId)), 'WRONG_VERSION', 'Outpoint is not a locked V3 data1 cell.');
  }
  const cell = await findLiveV3(client, typeId);
  if (parsed.kind === 'outPoint') invariant(cell.outPoint.txHash === parsed.txHash && cell.outPoint.index === BigInt(parsed.index), 'CELL_CHANGED', 'The requested outpoint is no longer the live state.');
  const metadata = decodeMetadata(ccc.bytesFrom(cell.outputData));
  const script = v3Script(typeId);
  const segments: { bytes: Uint8Array; previousChecksum: number; checksum: number; txHash: ccc.Hex; headWitnessIndex: number; chunkCount: number; byteLength: number }[] = [];
  const seenTransactions = new Set<string>();
  let txHash = cell.outPoint.txHash, index = metadata.index, expectedChecksum = metadata.checksum;
  let total = 0, chunks = 0;
  let descendantInputs: ccc.CellInput[] | undefined;
  while (true) {
    invariant(segments.length < maxDepth, 'HISTORY_LIMIT', `History exceeds ${maxDepth} segments.`);
    invariant(!seenTransactions.has(txHash), 'BACKLINK_LOOP', 'Repeated transaction in V3 history.');
    seenTransactions.add(txHash);
    const tx = await committedTransaction(client, txHash);
    const positions = tx.outputs.flatMap((o, i) => o.type?.eq(script) ? [i] : []);
    invariant(positions.length === 1, 'INVALID_WITNESS_CHAIN', 'History transaction must contain exactly one output for this V3 Type ID.');
    const outputIndex = positions[0];
    const state = decodeMetadata(ccc.bytesFrom(tx.outputsData[outputIndex]));
    invariant(state.index === index && state.checksum === expectedChecksum && state.filename === metadata.filename && state.contentType === metadata.contentType,
      'INVALID_WITNESS_CHAIN', 'Backlink does not match the previous cell metadata or immutable filename/MIME type.');
    if (descendantInputs) invariant(descendantInputs.some(i => i.previousOutput.txHash === txHash && i.previousOutput.index === BigInt(outputIndex)),
      'INVALID_WITNESS_CHAIN', 'Append did not consume the cell referenced by its backlink.');
    else invariant(BigInt(outputIndex) === cell.outPoint.index && tx.outputsData[outputIndex] === cell.outputData,
      'CELL_CHANGED', 'Live cell data disagrees with its creating transaction.');
    invariant(index < tx.witnesses.length, 'INVALID_WITNESS_INDEX', 'Head witness index is out of bounds.');
    const head = decodeHead(ccc.bytesFrom(tx.witnesses[index]));
    const parts = [head.content];
    total += head.content.length; chunks++;
    const seenIndexes = new Set([index]);
    let next = head.nextIndex;
    while (next !== 0) {
      invariant(!seenIndexes.has(next), 'WITNESS_LOOP', 'Repeated witness index in segment.');
      invariant(next < tx.witnesses.length, 'INVALID_WITNESS_INDEX', `Continuation witness ${next} is out of bounds.`);
      invariant(chunks < maxChunks && total <= maxBytes, 'RESOURCE_LIMIT', 'V3 file exceeds configured byte/chunk limits.');
      seenIndexes.add(next);
      const witness = ccc.bytesFrom(tx.witnesses[next]);
      next = readU32(witness);
      parts.push(witness.slice(4)); total += witness.length - 4; chunks++;
    }
    invariant(chunks <= maxChunks && total <= maxBytes, 'RESOURCE_LIMIT', 'V3 file exceeds configured byte/chunk limits.');
    const bytes = concat(parts);
    segments.push({ bytes, previousChecksum: head.previousChecksum, checksum: state.checksum, txHash, headWitnessIndex: index, chunkCount: parts.length, byteLength: bytes.length });
    if (head.previousTxHash === ZERO_HASH) break;
    descendantInputs = tx.inputs;
    txHash = head.previousTxHash; index = head.previousWitnessIndex; expectedChecksum = head.previousChecksum;
  }
  segments.reverse();
  let checksum = 1;
  segments.forEach((segment, i) => {
    invariant(segment.previousChecksum === (i === 0 ? 0 : checksum), 'CHECKSUM_MISMATCH', 'Historical backlink checksum mismatch.');
    checksum = adler32(segment.bytes, checksum);
    invariant(checksum === segment.checksum, 'CHECKSUM_MISMATCH', `Cumulative Adler32 mismatch at ${segment.txHash}.`);
  });
  invariant(checksum === metadata.checksum, 'CHECKSUM_MISMATCH', 'Current V3 checksum does not match resolved bytes.');
  return { protocol: CKBFS_PROTOCOL_V3, network: 'testnet', typeId, filename: metadata.filename, contentType: metadata.contentType,
    fileBytes: concat(segments.map(s => s.bytes)), size: total, checksum, checksumValid: true,
    currentOutPoint: { txHash: cell.outPoint.txHash, index: ccc.numToHex(cell.outPoint.index) },
    history: segments.map(({ bytes: _bytes, previousChecksum: _previous, checksum: _checksum, ...history }) => history) };
}
