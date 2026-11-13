import { describe, expect, it } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { albumSchema, formatTime, parseAlbum, parseLibrary, stepIndex, trackOrigin, verifyTrackBytes, type Track } from '../src/music/catalog';

const hash = (bytes: Uint8Array) => ccc.hashCkb(bytes);
const bytes = new Uint8Array([1, 2, 3, 4]);
const base = { n: 1, title: 'Eaglesong', style: 'old school', duration: 125, source: 'RFC 1', link: 'https://github.com/nervosnetwork/rfcs', cover: '/music/covers/05.jpg', lyrics: '[Verse]\nhi' };
const onChain: Track = { ...base, ckbfs: { typeId: '0x' + 'ab'.repeat(32), contentHash: hash(bytes), bytes: bytes.length, contentType: 'audio/webm' } };
const hosted: Track = { ...base, n: 2, url: '/music/audio/05.mp3' };
const album = { artist: 'Based Knowledge', album: 'Requests for Comment vol. 1', year: '2026', note: 'free', tracks: [onChain, hosted] };

describe('music catalog', () => {
  it('accepts a track stored on CKBFS and a track hosted with the site', () => {
    expect(parseAlbum(album).tracks).toHaveLength(2);
  });
  it('rejects a track with no playable source', () => {
    expect(() => parseAlbum({ ...album, tracks: [base] })).toThrow();
  });
  it('rejects an empty album', () => {
    expect(() => parseAlbum({ ...album, tracks: [] })).toThrow();
  });
  it('rejects a hosted url that leaves the site', () => {
    expect(() => parseAlbum({ ...album, tracks: [{ ...base, url: 'https://evil.example/x.mp3' }] })).toThrow();
    expect(() => parseAlbum({ ...album, tracks: [{ ...base, url: '//evil.example/x.mp3' }] })).toThrow();
    expect(() => parseAlbum({ ...album, tracks: [{ ...base, url: 'javascript:alert(1)' }] })).toThrow();
  });
  it('rejects a source link that is not https', () => {
    expect(() => parseAlbum({ ...album, tracks: [{ ...hosted, link: 'javascript:alert(1)' }] })).toThrow();
  });
  it('rejects a non-audio CKBFS content type and a malformed type id', () => {
    expect(() => albumSchema.parse({ ...album, tracks: [{ ...onChain, ckbfs: { ...onChain.ckbfs!, contentType: 'text/html' } }] })).toThrow();
    expect(() => albumSchema.parse({ ...album, tracks: [{ ...onChain, ckbfs: { ...onChain.ckbfs!, typeId: '0x1234' } }] })).toThrow();
  });
  it('rejects duplicate track numbers', () => {
    expect(() => parseAlbum({ ...album, tracks: [hosted, { ...hosted }] })).toThrow('unique');
  });
});

describe('music library', () => {
  const vol = (id: string) => ({ ...album, id });
  it('accepts several albums, each with its own track numbering', () => {
    expect(parseLibrary({ albums: [vol('vol-1'), vol('vol-2')] }).albums.map(a => a.id)).toEqual(['vol-1', 'vol-2']);
  });
  it('rejects an empty library', () => {
    expect(() => parseLibrary({ albums: [] })).toThrow();
  });
  it('rejects two albums with the same id', () => {
    expect(() => parseLibrary({ albums: [vol('vol-1'), vol('vol-1')] })).toThrow('unique');
  });
  it('rejects an album without an id, or with one that is not a plain slug', () => {
    expect(() => parseLibrary({ albums: [album] })).toThrow();
    expect(() => parseLibrary({ albums: [vol('Vol 1/..')] })).toThrow();
  });
  it('rejects a bad track inside any album', () => {
    expect(() => parseLibrary({ albums: [vol('vol-1'), { ...vol('vol-2'), tracks: [base] }] })).toThrow();
  });
});

describe('track verification', () => {
  it('passes bytes that match the catalog', () => {
    expect(() => verifyTrackBytes(bytes, 'audio/webm', onChain)).not.toThrow();
  });
  it('rejects a wrong length before hashing', () => {
    expect(() => verifyTrackBytes(new Uint8Array([1, 2, 3]), 'audio/webm', onChain)).toThrow('BYTE_LENGTH_MISMATCH');
  });
  it('rejects same-length bytes with a different hash', () => {
    expect(() => verifyTrackBytes(new Uint8Array([1, 2, 3, 5]), 'audio/webm', onChain)).toThrow('CONTENT_HASH_MISMATCH');
  });
  it('rejects chain metadata that is not the audio type the catalog promised', () => {
    expect(() => verifyTrackBytes(bytes, 'text/html', onChain)).toThrow('UNSUPPORTED_CONTENT_TYPE');
    expect(() => verifyTrackBytes(bytes, 'audio/mpeg', onChain)).toThrow('UNSUPPORTED_CONTENT_TYPE');
  });
});

describe('player helpers', () => {
  it('formats time as m:ss and tolerates bad input', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
  });
  it('steps through tracks and stops at the ends', () => {
    expect(stepIndex(0, 1, 13)).toBe(1);
    expect(stepIndex(12, 1, 13)).toBeNull();
    expect(stepIndex(0, -1, 13)).toBeNull();
    expect(stepIndex(5, -1, 13)).toBe(4);
  });
  it('labels where a track comes from, preferring the chain', () => {
    expect(trackOrigin(onChain)).toBe('ckbfs');
    expect(trackOrigin(hosted)).toBe('hosted');
    expect(trackOrigin({ ...onChain, url: '/music/audio/05.mp3' })).toBe('ckbfs');
  });
});
