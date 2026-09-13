import * as ccc from '@ckb-ccc/core';
import { proofDB } from '../proof/journal';
import { screenshotSchema, type Screenshot } from '../registry/manifest';
import type { ChainClient } from '../ckbfs/client';
import { resolveV3 } from '../ckbfs/resolver';
import { invariant } from '../ckbfs/errors';
import { validateScreenshot, SCREENSHOT_MAX_BYTES } from './image';
export function verifyScreenshot(bytes: Uint8Array, screenshot: Screenshot) {
  screenshotSchema.parse(screenshot); validateScreenshot(bytes, screenshot.contentType);
  invariant(bytes.length === screenshot.bytes && ccc.hashCkb(bytes) === screenshot.contentHash, 'SCREENSHOT_HASH_MISMATCH', 'Screenshot bytes do not match the verified catalog.');
}
export async function loadScreenshot(screenshot: Screenshot, client: ChainClient, offline = false) {
  screenshotSchema.parse(screenshot);
  const db = await proofDB(); const key = `screenshot:${screenshot.ckbfs.typeId}:${screenshot.contentHash}`;
  const cached = await db.get('demos', key);
  if (cached) { const bytes = new Uint8Array(cached.bytes); verifyScreenshot(bytes, screenshot); return bytes; }
  invariant(!offline, 'OFFLINE_NOT_CACHED', 'Screenshot is not cached. Reconnect to download it.');
  const resolved = await resolveV3(screenshot.ckbfs.typeId, { client, maxBytes: SCREENSHOT_MAX_BYTES });
  invariant(resolved.currentOutPoint.txHash === screenshot.ckbfs.txHash && resolved.contentType === screenshot.contentType, 'SCREENSHOT_CHANGED', 'Screenshot CKBFS state differs from the catalog.');
  verifyScreenshot(resolved.fileBytes, screenshot);
  await db.put('demos', { bytes: resolved.fileBytes }, key); return resolved.fileBytes;
}
