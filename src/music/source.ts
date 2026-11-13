import { resolveV3 } from '../ckbfs/resolver';
import type { ChainClient } from '../ckbfs/client';
import { verifyTrackBytes, type Track } from './catalog';

/**
 * Turn a track into something an <audio> element can play.
 *
 * On-chain tracks are resolved from CKBFS, verified against the catalog and
 * handed over as a blob: URL, so unverified bytes never reach the decoder.
 * Verified tracks are kept for the session; a track is a few hundred kB and
 * re-resolving it costs several RPC round trips.
 */
const verified = new Map<string, string>();

export async function trackUrl(track: Track, client: ChainClient): Promise<{ url: string; origin: 'ckbfs' | 'hosted'; cached: boolean }> {
  const pointer = track.ckbfs;
  if (!pointer) return { url: track.url!, origin: 'hosted', cached: false };
  const key = `${pointer.typeId}:${pointer.contentHash}`;
  const known = verified.get(key);
  if (known) return { url: known, origin: 'ckbfs', cached: true };
  const file = await resolveV3(pointer.typeId, { client, maxBytes: 8 * 1024 * 1024 });
  verifyTrackBytes(file.fileBytes, file.contentType, track);
  const url = URL.createObjectURL(new Blob([file.fileBytes as BlobPart], { type: pointer.contentType }));
  verified.set(key, url);
  return { url, origin: 'ckbfs', cached: false };
}
