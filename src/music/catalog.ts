import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { invariant } from '../ckbfs/errors';

/**
 * The music catalog is a static file shipped with the site (public/music/library.json):
 * a list of albums, each with its own tracks.
 * A track is played from CKBFS when it has a `ckbfs` pointer, and its bytes are
 * verified against the catalog before they reach the audio element. `url` is a
 * same-site fallback for tracks that have not been published on chain yet.
 */
const hex32 = z.string().regex(/^0x[\da-f]{64}$/, 'expected a 32-byte hex value');
const sitePath = z.string().regex(/^\/(?!\/)[\w./ ()',-]+$/, 'expected a path on this site');
const httpsLink = z.string().url().refine(value => value.startsWith('https://'), 'expected an https link');

const trackSchema = z.object({
  n: z.number().int().positive(),
  title: z.string().min(1).max(120),
  style: z.string().max(40),
  duration: z.number().positive(),
  source: z.string().max(120),
  link: httpsLink,
  cover: sitePath.optional(),
  lyrics: z.string().max(8000),
  url: sitePath.optional(),
  ckbfs: z.object({
    typeId: hex32,
    contentHash: hex32,
    bytes: z.number().int().positive(),
    contentType: z.string().regex(/^audio\/[\w.+-]+$/, 'expected an audio content type'),
  }).optional(),
}).refine(track => track.url !== undefined || track.ckbfs !== undefined, 'a track needs a CKBFS pointer or a hosted url');

export const albumSchema = z.object({
  artist: z.string().min(1).max(80),
  album: z.string().min(1).max(120),
  year: z.string().max(8),
  note: z.string().max(600),
  tracks: z.array(trackSchema).min(1)
    .refine(tracks => new Set(tracks.map(t => t.n)).size === tracks.length, 'track numbers must be unique'),
});

const albumId = z.string().regex(/^[a-z\d]+(-[a-z\d]+)*$/, 'expected a lowercase slug').max(40);

export const librarySchema = z.object({
  albums: z.array(albumSchema.extend({ id: albumId })).min(1)
    .refine(albums => new Set(albums.map(a => a.id)).size === albums.length, 'album ids must be unique'),
});

export type Track = z.infer<typeof trackSchema>;
export type Album = z.infer<typeof albumSchema>;
export type Library = z.infer<typeof librarySchema>;

export function parseAlbum(value: unknown): Album {
  return albumSchema.parse(value);
}

export function parseLibrary(value: unknown): Library {
  return librarySchema.parse(value);
}

export function trackOrigin(track: Track): 'ckbfs' | 'hosted' {
  return track.ckbfs ? 'ckbfs' : 'hosted';
}

/** Refuse bytes that are not exactly what the catalog promised. Length first: it is free. */
export function verifyTrackBytes(bytes: Uint8Array, contentType: string, track: Track): void {
  const pointer = track.ckbfs;
  invariant(pointer, 'NOT_ON_CHAIN', 'This track has no CKBFS pointer.');
  invariant(bytes.length === pointer.bytes, 'BYTE_LENGTH_MISMATCH', 'Track byte count differs from the catalog.');
  invariant(ccc.hashCkb(bytes) === pointer.contentHash, 'CONTENT_HASH_MISMATCH', 'Track hash differs from the catalog. It will not be played.');
  invariant(contentType.split(';')[0].trim().toLowerCase() === pointer.contentType.toLowerCase(),
    'UNSUPPORTED_CONTENT_TYPE', 'CKBFS file metadata is not the audio type the catalog lists.');
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The next index in a direction, or null at either end of the album. */
export function stepIndex(current: number, delta: 1 | -1, count: number): number | null {
  const next = current + delta;
  return next >= 0 && next < count ? next : null;
}
