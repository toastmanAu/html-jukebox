import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLibrary, trackHash } from '../src/music/catalog';
import { sharePage, sharePages, sharePath, SITE_ORIGIN } from '../src/music/share';

const track = { n: 5, title: 'Block Template', style: 'trap', duration: 144, source: 'RFC 13 §2', link: 'https://github.com/nervosnetwork/rfcs', cover: '/music/covers/v3/05.jpg', lyrics: 'la', url: '/music/audio/05.mp3' };
const album = { id: 'vol-3', artist: 'Based Knowledge', album: 'Requests for Comment vol. 3', year: '2026', note: 'free', tracks: [track] };

describe('share pages', () => {
  it('gives every track a path a server can see', () => {
    expect(sharePath('vol-3', 5)).toBe('/s/vol-3/5');
  });
  it('carries the title, artist, album and cover for a link preview', () => {
    const html = sharePage(album, track);
    expect(html).toContain('<meta property="og:title" content="Block Template · Based Knowledge"/>');
    expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}/music/covers/v3/05.jpg"/>`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/s/vol-3/5"/>`);
    expect(html).toContain('Requests for Comment vol. 3');
    expect(html).toContain('<meta name="twitter:card" content="summary"/>');
  });
  it('sends a person on to the track in the music room', () => {
    const html = sharePage(album, track);
    expect(html).toContain(`data-to="/${trackHash('vol-3', 5)}"`);
    expect(html).toContain('<script src="/share.js"></script>');
    expect(html).toContain(`<a href="/${trackHash('vol-3', 5)}">`);
  });
  it('has no inline script, which the site policy would block', () => {
    expect(sharePage(album, track)).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });
  it('escapes text so a title cannot break out of the page', () => {
    const html = sharePage(album, { ...track, title: 'A "quoted" <b>&' });
    expect(html).toContain('A &quot;quoted&quot; &lt;b&gt;&amp;');
    expect(html).not.toContain('<b>');
  });
  it('leaves the image out for a track with no cover', () => {
    const { cover: _cover, ...bare } = track;
    expect(sharePage(album, bare)).not.toContain('og:image');
  });
  it('makes one page per track of the shipped library, each with a cover that exists', () => {
    const library = parseLibrary(JSON.parse(readFileSync('public/music/library.json', 'utf8')));
    const pages = sharePages(library);
    expect(pages).toHaveLength(library.albums.reduce((sum, a) => sum + a.tracks.length, 0));
    expect(new Set(pages.map(p => p.fileName)).size).toBe(pages.length);
    expect(pages[0].fileName).toBe(`s/${library.albums[0].id}/${library.albums[0].tracks[0].n}.html`);
    for (const a of library.albums) for (const t of a.tracks) if (t.cover) expect(() => readFileSync(`public${t.cover}`)).not.toThrow();
  });
});
