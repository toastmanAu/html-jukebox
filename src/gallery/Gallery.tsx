import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { JUKEBOX_CONFIG } from '../../config/jukebox';
import { createPudgeClient } from '../ckbfs/client';
import { formatDiagnostic } from '../ckbfs/errors';
import { loadCatalog, loadDemo, type DemoItem } from '../player/cache';
import { Player } from '../player/Player';
import { proofDB } from '../proof/journal';
import './gallery.css';
import { Screenshot } from '../screenshots/Screenshot';
import { readPlayCounts, recordPlay, playLabel } from '../plays/client';
const Cabinet = lazy(() => import('./Cabinet'));
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="cabinet-fallback"><span>CKBFS</span><strong>JUKEBOX</strong><i/><small>EVERY DEMO HAS A PLACE</small></div> : this.props.children; }
}
const defaultRpc = 'https://testnet.ckb.dev/';
export default function Gallery() {
  const [items, setItems] = useState<DemoItem[]>([]), [selected, setSelected] = useState(0), [query, setQuery] = useState(''), [category, setCategory] = useState('All selections');
  const [offline, setOffline] = useState(false), [status, setStatus] = useState('Reading the on-chain registry…'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState('');
  const [settings, setSettings] = useState(false), [rpc, setRpc] = useState(defaultRpc), [endpoint, setEndpoint] = useState(defaultRpc), [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [favorites, setFavorites] = useState<string[]>([]), [favoritesOnly, setFavoritesOnly] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0), [cachedIds, setCachedIds] = useState<string[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [playStatus, setPlayStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (items.length) readPlayCounts(items.map(item => item.ckbfs.typeId)).then(counts => { if (!cancelled) { setPlayCounts(current => Object.fromEntries(Object.entries(counts).map(([id, value]) => [id, Math.max(current[id] ?? 0, value)]))); setPlayStatus(''); } }).catch(() => { if (!cancelled) setPlayStatus('Play counts are temporarily unavailable.'); });
    return () => { cancelled = true; };
  }, [items, refreshKey]);
  function demoLoaded(demoId: string, loadId: string) {
    recordPlay(demoId, loadId).then(value => { setPlayCounts(current => ({ ...current, [demoId]: Math.max(current[demoId] ?? 0, value) })); setPlayStatus(''); }).catch(() => setPlayStatus('This play could not be counted. Playback is still available.'));
  }
  const selector = useRef<HTMLDivElement>(null);
  const settingsPanel = useRef<HTMLElement>(null);
  const [player, setPlayer] = useState<{ item: DemoItem; bytes: Uint8Array; cached: boolean }>();
  const touchStart = useRef<number | undefined>(undefined); const wheelTime = useRef(0); const playButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { proofDB().then(async db => { const saved = await db.get('preferences', 'gallery'); if (saved) { setFavorites(saved.favorites ?? []); setReduced(saved.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches); setRpc(saved.rpc ?? defaultRpc); setEndpoint(saved.rpc ?? defaultRpc); setCategory(saved.category ?? 'All selections'); } }).catch(e => setError(formatDiagnostic(e))); }, []);
  useEffect(() => { let cancelled = false;
    async function refresh() {
      setStatus('Reading the on-chain registry…'); setError('');
      if (!JUKEBOX_CONFIG.registryTypeId) { setError('MISSING_REGISTRY: Finish first registry creation in the service panel.'); return; }
      try { const loaded = await loadCatalog(JUKEBOX_CONFIG.registryTypeId, createPudgeClient(rpc)); if (cancelled) return; setItems(loaded.manifest.manifest.items.filter(i => !i.status || i.status === 'active').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))); setRevision(loaded.registryRevision); setOffline(loaded.offline); setStatus(loaded.offline ? 'OFFLINE / LAST VERIFIED' : 'PUDGE / CATALOG VERIFIED'); }
      catch (e) { if (!cancelled) { setError(formatDiagnostic(e)); setStatus('CATALOG UNAVAILABLE'); } }
    }
    refresh(); return () => { cancelled = true; };
  }, [rpc, refreshKey]);
  async function savePreferences(next: { favorites?: string[]; reduced?: boolean; rpc?: string; category?: string }) {
    const prefs = { favorites, reduced, rpc, category, ...next }; await (await proofDB()).put('preferences', prefs, 'gallery');
  }
  const categories = ['All selections', ...new Set(items.map(i => i.category ?? 'Experiments'))];
  const activeCategory = categories.includes(category) ? category : 'All selections';
  const filtered = items.filter(i => (activeCategory === 'All selections' || (i.category ?? 'Experiments') === activeCategory) && (!favoritesOnly || favorites.includes(i.id)) && `${i.title} ${i.description ?? ''} ${(i.tags ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const index = Math.min(selected, Math.max(0, filtered.length - 1)), item = filtered[index];
  useEffect(() => { let cancelled = false; proofDB().then(async db => { const keys = await db.getAllKeys('demos'); if (!cancelled) setCachedIds(keys.map(String)); }).catch(e => setError(formatDiagnostic(e))); return () => { cancelled = true; }; }, [items, player]);
  useEffect(() => { const option = selector.current?.querySelector<HTMLElement>('[aria-selected="true"]'); if (!option) return; const list = selector.current!; if (option.offsetTop < list.scrollTop || option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop - (list.clientHeight - option.offsetHeight) / 2; }, [index, item?.id]);
  useEffect(() => { if (settings) settingsPanel.current?.focus(); }, [settings]);
  function move(delta: number) { if (filtered.length) setSelected((index + delta + filtered.length) % filtered.length); }
  async function play() {
    if (!item || busy) return; setBusy(true); setError('');
    try { const result = await loadDemo(item, createPudgeClient(rpc), offline); setPlayer({ item, ...result }); }
    catch (e) { setError(formatDiagnostic(e)); } finally { setBusy(false); }
  }
  const webgl = useRef<boolean | null>(null);
  if (webgl.current === null) { try { webgl.current = !!document.createElement('canvas').getContext('webgl2'); } catch { webgl.current = false; } }
  return <div className={`gallery-shell ${reduced ? 'reduced-motion' : ''}`}>
    <div className="room-light" aria-hidden="true"/><div className="room-floor" aria-hidden="true"/>
    <main className={`jukebox-machine ${busy ? 'is-launching' : ''}`} aria-label="CKBFS jukebox">
      <div className="cabinet-crown" aria-hidden="true"/><div className="light-tube tube-left" aria-hidden="true"/><div className="light-tube tube-right" aria-hidden="true"/>
      <div className="machine-interior">
        <header className="machine-marquee"><span className="marquee-star" aria-hidden="true">✦</span><div><span className="maker">CKBFS</span><h1>Jukebox</h1><p>THE HTML COLLECTION</p></div><span className="marquee-star" aria-hidden="true">✦</span></header>
        <div className="mechanism-window" aria-label="Record mechanism"><div className="mechanism-scene">{!player && <SceneBoundary>{webgl.current ? <Suspense fallback={<div className="cabinet-loading">WARMING UP…</div>}><Cabinet selection={index} reduced={reduced} launching={busy}/></Suspense> : <div className="cabinet-fallback"><i/></div>}</SceneBoundary>}</div><div className="glass-shine"/><div className="mechanism-label">HIGH FIDELITY <span>✦</span> INTERACTIVE WORLDS</div></div>
      <section className="selection-console" aria-label="Jukebox selections" onKeyDown={e => { if (!(e.target as HTMLElement).closest('.title-selector')) return; if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); } }} onTouchStart={e => { touchStart.current = e.touches[0]?.clientY; }} onTouchEnd={e => { if (touchStart.current !== undefined && e.changedTouches[0]) { const distance = touchStart.current - e.changedTouches[0].clientY; if (Math.abs(distance) > 45) move(distance > 0 ? 1 : -1); } }} onWheel={e => { if (Date.now() - wheelTime.current > 200 && Math.abs(e.deltaY) > 12) { move(e.deltaY > 0 ? 1 : -1); wheelTime.current = Date.now(); } }}>
        <div className="console-top"><span>SELECT A TITLE</span><span>{String(filtered.length).padStart(2, '0')} TITLES</span></div>
        <label className="gallery-search"><span className="sr-only">Search demos</span><input type="search" placeholder="Search the selections" value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }}/><span aria-hidden="true">⌕</span></label>
        <div className="category-strip" aria-label="Categories">{categories.map(c => <button key={c} aria-pressed={activeCategory === c} onClick={() => { setCategory(c); setSelected(0); savePreferences({ category: c }).catch(e => setError(formatDiagnostic(e))); }}>{c}</button>)}</div>
        <div ref={selector} className="title-selector" role="listbox" aria-label="Demo titles" tabIndex={0} aria-activedescendant={item ? `demo-${item.id}` : undefined} onKeyDown={e => { if (e.key === 'Enter' && item) { e.preventDefault(); play(); } else if (e.key === 'Home') { e.preventDefault(); setSelected(0); } else if (e.key === 'End') { e.preventDefault(); setSelected(filtered.length - 1); } }}>{filtered.length ? filtered.map((entry, i) => <button role="option" id={`demo-${entry.id}`} tabIndex={-1} aria-selected={index === i} key={entry.id} style={{ '--card-order': Math.min(i, 5) } as CSSProperties} className={`title-strip ${index === i ? 'selected' : ''}`} onClick={() => setSelected(i)}><span className="app-art">{entry.screenshot ? <Screenshot key={entry.screenshot.contentHash} screenshot={entry.screenshot} rpc={rpc} offline={offline}/> : <span aria-hidden="true"><span className="app-orbit orbit-one"/><span className="app-orbit orbit-two"/><span className="app-core"/><span className="app-index">{String(i + 1).padStart(2, '0')}</span></span>}</span><span className="app-card-copy"><small>{entry.category ?? 'Experiments'}</small><strong>{entry.title}</strong><span className="app-card-state">{playLabel(playCounts[entry.ckbfs.typeId])}</span></span><span className="title-arrow">↗</span></button>) : <div className="empty-title"><span className="title-number">01</span><div><strong>{query || favoritesOnly ? 'No matching selections' : 'The first track is yours.'}</strong><p>{query || favoritesOnly ? 'Try another search or clear the favorites filter.' : 'The cabinet is ready. Add the first HTML demo through the service panel.'}</p><a href="#service">Open service panel ↗</a></div></div>}</div>
        <div className="selector-controls"><button aria-label="Previous demo" disabled={!filtered.length} onClick={() => move(-1)}>↑</button><span>{filtered.length ? `${String(index + 1).padStart(2, '0')} / ${String(filtered.length).padStart(2, '0')}` : 'AWAITING FIRST SELECTION'}</span><button aria-label="Next demo" disabled={!filtered.length} onClick={() => move(1)}>↓</button></div>
        <div key={item?.id ?? 'empty'} className="selected-detail"><span className="eyebrow">{item ? 'NOW SELECTED' : 'THE COLLECTION'}</span><h2>{item?.title ?? 'Make a selection'}</h2><p>{item?.description || 'Choose a title, then press play.'}</p>{item && <div className="demo-meta"><span aria-label="Shared play count">{playLabel(playCounts[item.ckbfs.typeId])}</span><span>{(item.bytes / 1024).toFixed(1)} KB</span><span>{cachedIds.includes(`${item.ckbfs.typeId}:${item.contentHash}`) ? 'DOWNLOADED' : 'ON-CHAIN'}</span><span>{item.capabilities.network ? 'HTTPS RESOURCES' : 'SELF-CONTAINED'}</span><button aria-label={favorites.includes(item.id) ? 'Remove favorite' : 'Add favorite'} onClick={() => { const next = favorites.includes(item.id) ? favorites.filter(id => id !== item.id) : [...favorites, item.id]; setFavorites(next); savePreferences({ favorites: next }).catch(e => setError(formatDiagnostic(e))); }}>{favorites.includes(item.id) ? '★' : '☆'}</button></div>}{!!item?.tags?.length && <p className="demo-tags">{item.tags.join(' · ')}</p>}</div>
        {playStatus && <p className="play-count-status" role="status">{playStatus}</p>}
        <button ref={playButton} className="play-button" disabled={!item || busy} onClick={play}><span>▶</span>{busy ? 'RESOLVING & VERIFYING…' : item ? 'PLAY THIS DEMO' : 'WAITING FOR THE FIRST DEMO'}<small>{item ? 'FREE PLAY' : 'ADD A TITLE IN THE SERVICE PANEL'}</small></button>
      </section>
        <div className="speaker-section"><div className="speaker-grille" aria-hidden="true"><span className="speaker-emblem">C</span></div><div className="coin-panel"><span>SELECT • PLAY • EXPLORE</span><div className="coin-slot" aria-hidden="true"/><strong>FREE<br/>PLAY</strong><nav aria-label="Machine controls"><button aria-expanded={settings} aria-controls="gallery-settings" onClick={() => setSettings(v => !v)}>Settings</button><a href="#service" className="service-link">Service panel</a></nav></div></div>
        <footer className="machine-status"><span className={offline ? 'offline-status' : ''} role="status">● {status}</span><span>{revision && `REGISTRY REV. ${revision} · `}CKBFS V3</span></footer>
      </div>
      <div className="cabinet-base" aria-hidden="true"><span>CKBFS · MODEL 01</span></div>
    </main>
    {settings && <section id="gallery-settings" ref={settingsPanel} tabIndex={-1} className="gallery-settings" aria-label="Jukebox settings"><h2>Machine settings</h2><button className="settings-close" onClick={() => setSettings(false)}>Close settings</button><button onClick={() => setRefreshKey(v => v + 1)}>Refresh on-chain catalog</button><label className="check"><input type="checkbox" checked={reduced} onChange={e => { setReduced(e.target.checked); savePreferences({ reduced: e.target.checked }).catch(e => setError(formatDiagnostic(e))); }}/>Reduced motion</label><label className="check"><input type="checkbox" checked={favoritesOnly} onChange={e => { setFavoritesOnly(e.target.checked); setSelected(0); }}/>Favorites only</label><label>Custom Pudge RPC / integrated indexer<input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={defaultRpc}/></label><button onClick={() => { try { const url = new URL(endpoint); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP(S) CKB RPC endpoint.'); setRpc(url.href); savePreferences({ rpc: url.href }).catch(e => setError(formatDiagnostic(e))); } catch (e) { setError(formatDiagnostic(e)); } }}>Apply endpoint</button><button onClick={() => navigator.storage.persist().then(granted => setStatus(granted ? 'OFFLINE STORAGE PERSISTENCE GRANTED' : 'BROWSER DID NOT GRANT PERSISTENT STORAGE')).catch(e => setError(formatDiagnostic(e)))}>Keep downloaded demos offline</button></section>}
    {error && <div role="alert" className="gallery-error">{error}<button onClick={() => setRefreshKey(v => v + 1)}>Retry catalog</button></div>}

    {player && <Player title={player.item.title} bytes={player.bytes} capabilities={player.item.capabilities} cached={player.cached} onLoaded={loadId => demoLoaded(player.item.ckbfs.typeId, loadId)} onClose={() => { setPlayer(undefined); requestAnimationFrame(() => playButton.current?.focus()); }}/>}
  </div>;
}
