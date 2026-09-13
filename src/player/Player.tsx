import { useEffect, useMemo, useRef, useState } from 'react';
import type { DemoCapabilities } from './policy';
import { iframePolicy, sandboxDocument } from './policy';
import { formatDiagnostic } from '../ckbfs/errors';
/** The separate sandbox page never imports app code. Only verified source + approved policy cross this boundary. */
export function Player({ bytes, title, capabilities, onClose, cached = false, preview = false, onLoaded }: {
  bytes: Uint8Array; title: string; capabilities: DemoCapabilities; onClose: () => void; cached?: boolean; preview?: boolean; onLoaded?: (loadId: string) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const [reload, setReload] = useState(0), [error, setError] = useState('');
  const loaded = useRef(onLoaded); loaded.current = onLoaded;
  const countedSession = useRef<string | undefined>(undefined);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const root = wrapper.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const hidden: { element: HTMLElement; inert: boolean }[] = [];
    // Disable the background while keeping the iframe and host controls interactive.
    let branch: HTMLElement = root;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) { hidden.push({ element: sibling, inert: sibling.inert }); sibling.inert = true; }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    document.body.style.overflow = 'hidden';
    root.querySelector<HTMLButtonElement>('button')?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      hidden.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const policy = useMemo(() => iframePolicy(capabilities), [capabilities]);
  const session = useMemo(() => crypto.randomUUID(), [bytes, capabilities, reload]);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.data?.session !== session) return;
      if (event.data.type === 'ckbfs-demo-loaded') {
        if (!preview && countedSession.current !== session) { countedSession.current = session; loaded.current?.(session); }
        return;
      }
      if (event.data.type !== 'ckbfs-sandbox-ready') return;
      try { frame.current!.contentWindow!.postMessage({ type: 'ckbfs-launch', session, html: sandboxDocument(bytes, capabilities), pointerLock: capabilities.pointerLock, allow: policy.allow }, '*'); }
      catch (e) { setError(formatDiagnostic(e)); }
    }
    window.addEventListener('message', onMessage); return () => window.removeEventListener('message', onMessage);
  }, [bytes, capabilities, policy, session, preview]);
  return <div className="demo-player" ref={wrapper} role="dialog" aria-modal="true" aria-label={title}>
    <div className="player-toolbar"><button onClick={onClose}>Back to Jukebox</button><strong>{title}</strong><span>{preview ? 'LOCAL / PRODUCTION SANDBOX' : cached ? 'CACHED / VERIFIED' : 'ON-CHAIN / VERIFIED'}</span><button onClick={() => setReload(v => v + 1)}>Reload demo</button>
      {capabilities.fullscreen && <button onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(e => setError(formatDiagnostic(e))); else wrapper.current?.requestFullscreen().catch(e => setError(formatDiagnostic(e))); }}>Fullscreen</button>}</div>
    {error && <p role="alert">{error}</p>}
    <iframe ref={frame} key={session} title={title} src={`/sandbox.html?session=${session}`} sandbox={policy.sandbox} allow={policy.allow} referrerPolicy="no-referrer"/>
  </div>;
}
