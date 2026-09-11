import { utf8 } from '../ckbfs/codec';
import type { ProofKind } from './journal';
export function proofBytes(kind: ProofKind): Uint8Array {
  if (kind === 'empty') return new Uint8Array();
  if (kind.startsWith('append')) return utf8.encode(`\n<!-- CKBFS ${kind} proof ${'A'.repeat(17000)} -->`);
  const padding = kind === 'multi' ? `<!--${'CKBFS-V3 '.repeat(5500)}-->` : '';
  return utf8.encode(`<!doctype html><html lang="en"><meta charset="utf-8"><title>CKBFS V3 proof</title><h1>CKBFS AI HTML Jukebox</h1><p>Pudge storage round-trip fixture.</p>${padding}</html>`);
}
export const proofLabels: Record<ProofKind, string> = { small: '01 · Single-witness HTML', multi: '02 · Multi-witness HTML', 'append-1': '03 · Append to the same Type ID', 'append-2': '04 · Append a second segment', empty: '05 · Empty-file boundary' };
