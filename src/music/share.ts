import type { Library, Track } from './catalog';

/**
 * Link previews. Chat apps and social sites read a page's meta tags without running
 * its script, and never see the part of an address after `#`. So every track also has
 * a small static page at `/s/<album id>/<track number>`, written at build time, that
 * carries the preview tags and sends a person on to the track in the music room.
 */
export const SITE_ORIGIN = 'https://htmljukebox.online';

type AlbumEntry = Library['albums'][number];

export function sharePath(albumId: string, n: number): string {
  return `/s/${albumId}/${n}`;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sharePage(album: Pick<AlbumEntry, 'id' | 'artist' | 'album'>, track: Pick<Track, 'n' | 'title' | 'style' | 'source' | 'cover'>, origin = SITE_ORIGIN): string {
  const title = escape(`${track.title} · ${album.artist}`);
  const description = escape(`${track.style ? `${track.style} · ` : ''}from ${album.album} · lyrics from ${track.source}`);
  const to = `/#music/${album.id}/${track.n}`;
  const image = track.cover ? [
    `<meta property="og:image" content="${escape(origin + track.cover)}"/>`,
    '<meta property="og:image:width" content="640"/>', '<meta property="og:image:height" content="640"/>',
    `<meta property="og:image:alt" content="${escape(`Cover art for ${track.title}`)}"/>`,
  ] : [];
  return [
    `<!doctype html><html lang="en" data-to="${to}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>`,
    `<title>${title}</title>`,
    `<meta name="description" content="${description}"/>`,
    '<meta property="og:type" content="music.song"/>', '<meta property="og:site_name" content="CKBFS Jukebox"/>',
    `<meta property="og:title" content="${title}"/>`,
    `<meta property="og:description" content="${description}"/>`,
    `<meta property="og:url" content="${escape(origin + sharePath(album.id, track.n))}"/>`,
    ...image,
    '<meta name="twitter:card" content="summary"/>',
    '<script src="/share.js"></script>',
    `</head><body><p><a href="${to}">Listen to ${escape(track.title)} by ${escape(album.artist)}</a></p></body></html>`,
  ].join('\n');
}

/** One page per track, as files for the build to write. */
export function sharePages(library: Library, origin = SITE_ORIGIN): { fileName: string; source: string }[] {
  return library.albums.flatMap(album => album.tracks.map(track => ({
    fileName: `${sharePath(album.id, track.n).slice(1)}.html`,
    source: sharePage(album, track, origin),
  })));
}
