import { useCallback, useEffect, useRef, useState } from 'react';
import { createPudgeClient } from '../ckbfs/client';
import { formatDiagnostic } from '../ckbfs/errors';
import { ModeToggle } from '../ModeToggle';
import { formatTime, parseLibrary, stepIndex, trackOrigin, type Library, type Track } from './catalog';
import { trackUrl } from './source';
import { createScope, type Scope } from './visualiser';
import './music.css';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The music half of the jukebox: an album player with a light show behind it.
 *
 * Two albums matter at once: the one on show in the track list (`shown`) and the one
 * the current track belongs to (`playingIn`). Browsing another album does not stop the music.
 */
export default function MusicRoom() {
  const [library, setLibrary] = useState<Library>();
  const [shown, setShown] = useState(0);
  const [playingIn, setPlayingIn] = useState(0);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [status, setStatus] = useState('Loading the album…');
  const [error, setError] = useState('');
  const [lyrics, setLyrics] = useState(false);
  const [lightShow, setLightShow] = useState(false);
  const [reduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const context = useRef<AudioContext | null>(null);
  const request = useRef(0);      // guards against a slow resolve landing after a newer selection
  const playingRef = useRef(false);
  playingRef.current = playing;

  const album = library?.albums[shown];
  const source = library?.albums[playingIn];
  const track: Track | undefined = source && index >= 0 ? source.tracks[index] : undefined;

  useEffect(() => {
    let cancelled = false;
    fetch('/music/library.json')
      .then(response => { if (!response.ok) throw new Error(`ALBUM_UNAVAILABLE: HTTP ${response.status}`); return response.json(); })
      .then(json => { if (!cancelled) { setLibrary(parseLibrary(json)); setStatus('Pick a track.'); } })
      .catch(e => { if (!cancelled) { setError(formatDiagnostic(e)); setStatus('The music could not be loaded.'); } });
    return () => { cancelled = true; };
  }, []);

  // The light show: one animation loop for the life of the page.
  useEffect(() => {
    if (!canvas.current) return;
    const scope: Scope = createScope(canvas.current, reduced);
    const spectrum = new Uint8Array(256);
    let frame = 0, last = 0;
    const onResize = () => scope.resize();
    addEventListener('resize', onResize);
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (reduced && now - last < 120) return;   // a still picture needs few updates
      last = now;
      if (analyser.current) analyser.current.getByteFrequencyData(spectrum); else spectrum.fill(0);
      scope.draw(spectrum, now / 1000, playingRef.current);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', onResize); };
  }, [reduced]);

  /** Route the audio element through an analyser. Needs a user gesture, so it runs on first play. */
  function connectAnalyser() {
    if (context.current || !audio.current) return;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 512; node.smoothingTimeConstant = 0.8;
      ctx.createMediaElementSource(audio.current).connect(node);
      node.connect(ctx.destination);
      context.current = ctx; analyser.current = node;
    } catch {
      // No Web Audio: the music still plays, the light show just idles.
    }
  }

  const select = useCallback(async (from: number, next: number) => {
    if (!library || !audio.current) return;
    const chosen = library.albums[from].tracks[next];
    const id = ++request.current;
    setPlayingIn(from); setIndex(next); setError(''); setTime(0); setLength(chosen.duration);
    audio.current.pause();
    connectAnalyser();
    context.current?.resume().catch(() => undefined);
    setStatus(trackOrigin(chosen) === 'ckbfs' ? 'Resolving from CKBFS and verifying…' : 'Loading…');
    try {
      const source = await trackUrl(chosen, createPudgeClient());
      if (id !== request.current) return;
      audio.current.src = source.url;
      setStatus(source.origin === 'ckbfs' ? (source.cached ? 'Verified on chain · cached' : 'Verified on chain') : 'Hosted with the site');
      await audio.current.play();
    } catch (e) {
      if (id !== request.current) return;
      // A blocked autoplay is not a failure: the controls are right there.
      if (e instanceof DOMException && e.name === 'NotAllowedError') { setStatus('Press play to start.'); return; }
      setError(formatDiagnostic(e)); setStatus('This track could not be played.');
    }
  }, [library]);

  function toggle() {
    if (!audio.current || !library) return;
    if (index < 0) { void select(shown, 0); return; }
    if (audio.current.paused) { context.current?.resume().catch(() => undefined); audio.current.play().catch(e => setError(formatDiagnostic(e))); }
    else audio.current.pause();
  }
  function step(delta: 1 | -1) {
    if (!source) return;
    const next = stepIndex(index, delta, source.tracks.length);
    if (next !== null) void select(playingIn, next);
  }

  useEffect(() => {
    if (!track || !source || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: source.artist, album: source.album,
      artwork: track.cover ? [{ src: track.cover, sizes: '640x640', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  });

  const atStart = index <= 0, atEnd = !source || index >= source.tracks.length - 1;
  return <div className={`music-shell ${lightShow ? 'light-show' : ''}`}>
    <canvas ref={canvas} className="scope" aria-hidden="true"/>
    <ModeToggle mode="music"/>
    <audio ref={audio} preload="none"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
      onLoadedMetadata={e => { if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration); }}
      onEnded={() => { if (atEnd) setPlaying(false); else step(1); }}
      onError={() => { if (audio.current?.src) { setError('PLAYBACK_FAILED: This browser could not decode the track.'); setStatus('This track could not be played.'); } }}/>

    <main className="deck" aria-label="Music player">
      <header className="deck-head">
        <p className="eyebrow">{album?.artist ?? 'CKBFS JUKEBOX'}</p>
        <h1>{album?.album ?? 'Music'}</h1>
        {library && library.albums.length > 1 && <div className="albums" role="group" aria-label="Albums">
          {library.albums.map((entry, i) => <button key={entry.id} type="button" aria-pressed={i === shown} onClick={() => setShown(i)}>
            {entry.album.replace(/^.*\b(vol\. \d+)$/i, '$1')}{i === playingIn && index >= 0 && <span className="sr-only"> (playing)</span>}
          </button>)}
        </div>}
      </header>

      <section className="now" aria-label="Now playing">
        <div className="cover">{track?.cover ? <img src={track.cover} alt="" width="320" height="320"/> : <span aria-hidden="true">{track ? pad(track.n) : '♪'}</span>}</div>
        <div className="readout">
          <span className="track-no" aria-hidden="true">{track ? pad(track.n) : '--'}</span>
          <span className="clock" aria-label="Elapsed time">{formatTime(time)}</span>
        </div>
        <h2>{track?.title ?? 'Nothing playing'}</h2>
        {track && source && source !== album && <p className="from">{source.album}</p>}
        {track && <p className="credit"><span className="style">{track.style}</span> · <a href={track.link} target="_blank" rel="noreferrer">{track.source}</a></p>}
        <p className="status" role="status">{status}</p>
        {error && <p className="music-error" role="alert">{error}</p>}
      </section>

      <section className="transport" aria-label="Playback controls">
        <label className="seek"><span className="sr-only">Seek</span>
          <input type="range" min={0} max={Math.max(1, Math.floor(length))} step={1} value={Math.min(Math.floor(time), Math.floor(length))}
            disabled={!track} onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value); }}
            aria-valuetext={`${formatTime(time)} of ${formatTime(length)}`}/>
          <span className="seek-time" aria-hidden="true">{formatTime(time)} / {formatTime(length)}</span>
        </label>
        <div className="buttons">
          <button type="button" onClick={() => step(-1)} disabled={!source || atStart} aria-label="Previous track">⏮</button>
          <button type="button" className="play" onClick={toggle} disabled={!album} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
          <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label="Next track">⏭</button>
        </div>
        <div className="switches">
          <button type="button" aria-pressed={lyrics} disabled={!track} onClick={() => setLyrics(v => !v)}>Lyrics</button>
          <button type="button" aria-pressed={lightShow} onClick={() => setLightShow(v => !v)}>{lightShow ? 'Show player' : 'Light show'}</button>
        </div>
      </section>

      {lyrics && track && <section className="lyrics" aria-label={`Lyrics for ${track.title}`}><pre>{track.lyrics}</pre></section>}

      <ol className="tracks" aria-label="Tracks">
        {album?.tracks.map((entry, i) => <li key={`${album.id}-${entry.n}`}>
          <button type="button" aria-current={shown === playingIn && i === index ? 'true' : undefined}
            onClick={() => shown === playingIn && i === index ? toggle() : void select(shown, i)}>
            <span className="tile" aria-hidden="true">{pad(entry.n)}</span>
            <span className="name">{entry.title}<small>{entry.style} · {trackOrigin(entry) === 'ckbfs' ? 'on chain' : 'hosted'}</small></span>
            <span className="len">{formatTime(entry.duration)}</span>
          </button>
        </li>)}
      </ol>

      {album && <footer className="deck-foot"><p>{album.note}</p></footer>}
    </main>
  </div>;
}
