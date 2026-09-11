import type { Hex } from '@ckb-ccc/core';
import { invariant } from './errors';
export type ParsedIdentifier = { kind: 'typeId'; typeId: Hex } | { kind: 'outPoint'; txHash: Hex; index: number };
/** Bare hashes always mean Type IDs. Outpoints must explicitly include :index. */
export function parseCKBFSIdentifier(input: string): ParsedIdentifier {
  const text = input.trim().replace(/^ckbfs:\/\/testnet\//i, '');
  const m = /^(0x[\da-f]{64})(?::(0x[\da-f]+|\d+))?$/i.exec(text);
  invariant(m, 'INVALID_IDENTIFIER', 'Use a 32-byte Type ID, ckbfs://testnet/<TypeID>, or txHash:outputIndex.');
  const hash = m[1].toLowerCase() as Hex;
  if (m[2] === undefined) return { kind: 'typeId', typeId: hash };
  const index = Number(m[2]);
  invariant(Number.isSafeInteger(index) && index >= 0 && index <= 0xffffffff, 'INVALID_IDENTIFIER', 'Output index is outside Uint32 range.');
  return { kind: 'outPoint', txHash: hash, index };
}
