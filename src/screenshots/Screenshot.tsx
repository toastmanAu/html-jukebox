import { useEffect, useRef, useState } from 'react';
import type { Screenshot as ScreenshotRecord } from '../registry/manifest';
import { createPudgeClient } from '../ckbfs/client';
import { formatDiagnostic } from '../ckbfs/errors';
import { loadScreenshot } from './cache';
export function Screenshot({ screenshot, rpc, offline }: { screenshot: ScreenshotRecord; rpc: string; offline: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false), [url, setUrl] = useState<string>(), [error, setError] = useState('');
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '100px' });
    observer.observe(root.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false; let objectUrl: string | undefined;
    setError(''); setUrl(undefined);
    loadScreenshot(screenshot, createPudgeClient(rpc), offline).then(bytes => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: screenshot.contentType })); setUrl(objectUrl);
    }).catch(e => { if (!cancelled) setError(formatDiagnostic(e)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [screenshot, rpc, offline, visible]);
  return <span ref={root} className="screenshot-art">{url && !error ? <img src={url} alt="" decoding="async" onError={() => setError('SCREENSHOT_DECODE: Verified screenshot could not be displayed.')}/> : <span className="screenshot-status" title={error || undefined}>{error ? 'Screenshot unavailable' : 'Loading screenshot…'}</span>}</span>;
}
/** Object URL lifecycle for the exact locally optimized screenshot shown to the owner. */
export function ScreenshotPreview({ bytes, contentType }: { bytes: Uint8Array; contentType: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const value = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: contentType })); setUrl(value); return () => URL.revokeObjectURL(value); }, [bytes, contentType]);
  return url ? <img className="screenshot-preview" style={{ display: 'block', maxWidth: '100%', maxHeight: 250, objectFit: 'contain', margin: '12px 0', borderRadius: 8 }} src={url} alt="Optimized screenshot to publish"/> : null;
}
