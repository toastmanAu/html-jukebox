import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { CKBFS_PROTOCOL_V3 } from '../../config/ckbfs-v3';
import { utf8 } from '../ckbfs/codec';
import type { ChainClient } from '../ckbfs/client';
import { invariant } from '../ckbfs/errors';
import { resolveV3 } from '../ckbfs/resolver';
export const byte32Schema = z.string().regex(/^0x[0-9a-f]{64}$/, 'Expected a lowercase 32-byte hex value.');
export const pointerSchema = z.object({ typeId: byte32Schema, contentHash: byte32Schema }).strict();
export type ManifestPointer = z.infer<typeof pointerSchema>;
export const capabilitiesSchema = z.object({ network: z.boolean(), audio: z.boolean(), fullscreen: z.boolean(), pointerLock: z.boolean(), geolocation: z.boolean(), clipboard: z.boolean() }).strict();
export const itemSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().optional(), category: z.string().optional(), tags: z.array(z.string()).optional(),
  status: z.enum(['active', 'hidden', 'archived']).optional(),
  ckbfs: z.object({ protocol: z.literal(CKBFS_PROTOCOL_V3), typeId: byte32Schema, txHash: byte32Schema.optional() }).passthrough(),
  contentHash: byte32Schema, filename: z.string().min(1), contentType: z.string().optional(), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime().optional(), featured: z.boolean().optional(), sort: z.number().finite().optional(), capabilities: capabilitiesSchema,
}).passthrough();
export const manifestSchema = z.object({
  schema: z.literal(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), createdAt: z.iso.datetime(),
  collection: z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().optional() }).passthrough(),
  previous: pointerSchema.nullable().optional(), items: z.array(itemSchema),
}).passthrough().superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  manifest.items.forEach((item, index) => { if (ids.has(item.id)) ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: 'Duplicate item ID.' }); ids.add(item.id); });
  if (manifest.revision === 1 && manifest.previous) ctx.addIssue({ code: 'custom', path: ['previous'], message: 'Initial manifest cannot reference a previous revision.' });
  if (manifest.revision > 1 && !manifest.previous) ctx.addIssue({ code: 'custom', path: ['previous'], message: 'Later manifests must identify the previous manifest.' });
});
export type Manifest = z.infer<typeof manifestSchema>;
export interface VerifiedManifest { pointer: ManifestPointer; manifest: Manifest; bytes: Uint8Array; txHash: ccc.Hex }
export function manifestBytes(value: unknown): Uint8Array { return utf8.encode(JSON.stringify(manifestSchema.parse(value))); }
export function decodeManifest(bytes: Uint8Array, expectedHash: string): Manifest {
  byte32Schema.parse(expectedHash);
  invariant(ccc.hashCkb(bytes) === expectedHash, 'MANIFEST_HASH_MISMATCH', 'Exact manifest bytes do not match the registry hash. Do not load this catalog.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('INVALID_MANIFEST: Expected UTF-8 JSON.'); }
  return manifestSchema.parse(value);
}
export async function resolveManifest(pointer: ManifestPointer, client: ChainClient): Promise<VerifiedManifest> {
  pointerSchema.parse(pointer);
  const file = await resolveV3(pointer.typeId, { client, maxBytes: 4 * 1024 * 1024 });
  invariant(/^application\/json(?:\s*;|$)/i.test(file.contentType), 'INVALID_MANIFEST', 'Manifest must be published as application/json.');
  const manifest = decodeManifest(file.fileBytes, pointer.contentHash);
  return { pointer, manifest, bytes: file.fileBytes, txHash: file.currentOutPoint.txHash };
}
export function initialManifest(createdAt = new Date().toISOString()): Manifest {
  return manifestSchema.parse({ schema: 1, revision: 1, createdAt, collection: { id: 'ai-html-jukebox', name: 'AI HTML Jukebox', description: 'Interactive HTML demos stored through CKBFS.' }, previous: null, items: [] });
}
export function nextManifest(current: VerifiedManifest, registryRevision: bigint, items: Manifest['items'], createdAt = new Date().toISOString()): Manifest {
  invariant(registryRevision < BigInt(Number.MAX_SAFE_INTEGER), 'REVISION_OVERFLOW', 'Manifest JSON revision exceeds the supported safe-integer range.');
  return manifestSchema.parse({ ...current.manifest, revision: Number(registryRevision + 1n), createdAt, previous: current.pointer, items });
}
/** Resolve and verify an ancestor before rollback; arbitrary unrelated catalogs are not eligible. */
export async function findManifestAncestor(current: VerifiedManifest, target: ManifestPointer, client: ChainClient, maxDepth = 128): Promise<VerifiedManifest> {
  pointerSchema.parse(target);
  const seen = new Set([current.pointer.typeId]);
  let cursor = current;
  for (let depth = 0; depth < maxDepth; depth++) {
    const previous = cursor.manifest.previous;
    invariant(previous, 'ROLLBACK_NOT_ANCESTOR', 'The requested rollback target is not in the current manifest history.');
    invariant(!seen.has(previous.typeId), 'MANIFEST_HISTORY_LOOP', 'Repeated manifest Type ID in history.'); seen.add(previous.typeId);
    const ancestor = await resolveManifest(previous, client);
    invariant(ancestor.manifest.collection.id === current.manifest.collection.id && ancestor.manifest.revision < cursor.manifest.revision,
      'INVALID_MANIFEST_HISTORY', 'Manifest history has an unrelated collection or nondecreasing revision.');
    if (previous.typeId === target.typeId && previous.contentHash === target.contentHash) return ancestor;
    cursor = ancestor;
  }
  throw new Error('MANIFEST_HISTORY_LIMIT: Rollback history exceeds the configured depth limit.');
}
