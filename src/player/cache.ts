import * as ccc from '@ckb-ccc/core';
import type { z } from 'zod';
import { proofDB } from '../proof/journal';
import { decodeManifest, resolveManifest, type itemSchema, type VerifiedManifest } from '../registry/manifest';
import { findRegistry, registryPointer } from '../registry/registry';
import { resolveV3 } from '../ckbfs/resolver';
import { CKBFSError, invariant } from '../ckbfs/errors';
import type { ChainClient } from '../ckbfs/client';
export type DemoItem = z.infer<typeof itemSchema>;
export function verifyDemo(bytes: Uint8Array, item: DemoItem) {
  invariant(bytes.length === item.bytes, 'BYTE_LENGTH_MISMATCH', 'Demo byte count differs from the verified manifest.');
  invariant(ccc.hashCkb(bytes) === item.contentHash, 'CONTENT_HASH_MISMATCH', 'Demo hash differs from the verified manifest. Do not execute it.');
  invariant(/^text\/html(?:\s*;|$)/i.test(item.contentType ?? 'text/html'), 'UNSUPPORTED_CONTENT_TYPE', 'The jukebox player accepts HTML demos only.');
}
export async function loadDemo(item: DemoItem, client: ChainClient, offline = false) {
  const db = await proofDB(); const key = `${item.ckbfs.typeId}:${item.contentHash}`;
  const cached = await db.get('demos', key);
  if (cached) {
    const bytes = new Uint8Array(cached.bytes); verifyDemo(bytes, item);
    await db.put('demos', { ...cached, lastPlayed: new Date().toISOString() }, key);
    return { bytes, cached: true };
  }
  invariant(!offline, 'OFFLINE_NOT_CACHED', 'This demo is not downloaded. Reconnect to Pudge to verify and cache it.');
  const result = await resolveV3(item.ckbfs.typeId, { client }); verifyDemo(result.fileBytes, item);
  invariant(/^text\/html(?:\s*;|$)/i.test(result.contentType), 'UNSUPPORTED_CONTENT_TYPE', 'CKBFS file metadata is not HTML.');
  await db.put('demos', { typeId: item.ckbfs.typeId, contentHash: item.contentHash, contentType: result.contentType, filename: result.filename,
    bytes: result.fileBytes, byteLength: result.size, fetchedAt: new Date().toISOString(), lastPlayed: new Date().toISOString() }, key);
  return { bytes: result.fileBytes, cached: false };
}
export async function loadCatalog(typeId: string, client: ChainClient): Promise<{ manifest: VerifiedManifest; offline: boolean; registryRevision: string }> {
  const db = await proofDB();
  try {
    const registry = await findRegistry(typeId, client); const pointer = registryPointer(registry);
    const cached = await db.get('manifests', pointer.typeId);
    let manifest: VerifiedManifest;
    if (cached?.contentHash === pointer.contentHash) {
      const bytes = new Uint8Array(cached.bytes);
      manifest = { pointer, manifest: decodeManifest(bytes, pointer.contentHash), bytes, txHash: cached.txHash };
    } else {
      manifest = await resolveManifest(pointer, client);
      await db.put('manifests', { bytes: manifest.bytes, contentHash: pointer.contentHash, txHash: manifest.txHash, fetchedAt: new Date().toISOString() }, pointer.typeId);
    }
    invariant(BigInt(manifest.manifest.revision) <= registry.data.revision, 'INVALID_REGISTRY', 'Manifest revision exceeds current registry revision.');
    await db.put('preferences', { pointer, registryRevision: registry.data.revision.toString() }, `active-manifest:${typeId}`);
    return { manifest, offline: false, registryRevision: registry.data.revision.toString() };
  } catch (error) {
    // An integrity failure or missing registry must stay visible; only unavailable transport allows offline fallback.
    if (error instanceof CKBFSError || error instanceof Error && !/fetch|network|timeout|transport|connect|rpc|offline/i.test(error.message)) throw error;
    const last = await db.get('preferences', `active-manifest:${typeId}`);
    invariant(last, 'OFFLINE_NO_CATALOG', 'Pudge is unavailable and no previously verified catalog is cached.');
    const cached = await db.get('manifests', last.pointer.typeId);
    invariant(cached?.contentHash === last.pointer.contentHash, 'OFFLINE_NO_CATALOG', 'Last verified manifest is not cached.');
    const bytes = new Uint8Array(cached.bytes);
    return { manifest: { pointer: last.pointer, bytes, manifest: decodeManifest(bytes, last.pointer.contentHash), txHash: cached.txHash }, registryRevision: last.registryRevision, offline: true };
  }
}
