import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { iframePolicy, sandboxDocument, DEFAULT_CAPABILITIES } from '../src/player/policy';
import { inspectHTML } from '../src/player/portability';
import { loadDemo, verifyDemo, type DemoItem } from '../src/player/cache';
import { proofDB } from '../src/proof/journal';
import { resolveV3 } from '../src/ckbfs/resolver';
import { chainFixture, typeId } from './fixtures';
import { utf8 } from '../src/ckbfs/codec';
import { CKBFS_PROTOCOL_V3 } from '../config/ckbfs-v3';
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
beforeEach(async () => { await (await proofDB()).clear('demos'); vi.clearAllMocks(); });
describe('production iframe policy', () => {
  it('never grants same-origin, top navigation, popups, camera or microphone', () => {
    const p = iframePolicy({ network: true, audio: true, fullscreen: true, geolocation: true, clipboard: true, pointerLock: true });
    expect(p.sandbox).toBe('allow-scripts allow-pointer-lock'); expect(p.allow).toContain("camera 'none'"); expect(p.allow).toContain("microphone 'none'");
    expect(p.allow).toContain("fullscreen 'none'"); // Only the host wrapper can enter fullscreen, retaining its toolbar.
  });
  it('blocks network resource loads when not approved and injects policy before untrusted source', () => {
    const p = iframePolicy(DEFAULT_CAPABILITIES); expect(p.csp).toContain("connect-src 'none'"); expect(p.csp).not.toContain('https:');
    const source = '<script>window.test=1</script>'; const doc = sandboxDocument(utf8.encode(source), DEFAULT_CAPABILITIES);
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf(source)); expect(doc.endsWith(source)).toBe(true);
  });
});
describe('nonexecuting portability inspection', () => {
  it('accepts fully inline and absolute HTTPS resources', () => {
    expect(inspectHTML('<style>body{background:#000}</style><h1>Hi</h1>').acceptable).toBe(true);
    const report = inspectHTML('<script src="https://cdn.example.test/demo.js"></script><img src="data:image/png;base64,aGVsbG8=">');
    expect(report.acceptable).toBe(true); expect(report.externalUrls).toEqual(['https://cdn.example.test/demo.js']);
  });
  it.each(['<script src="./demo.js"></script>', '<link rel="stylesheet" href="styles.css">', '<audio src="audio.mp3"></audio>', '<style>body{background:url(./bg.png)}</style>', '<script>import x from "./x.js"</script>', '<script>fetch("./data.json")</script>', '<script>xhr.open("GET", "./api")</script>', '<script>new Worker("worker.js")</script>', '<script>loader.load("./model.glb")</script>'])('rejects unresolved dependency: %s', source => {
    const result = inspectHTML(source); expect(result.acceptable).toBe(false); expect(result.issues.some(i => i.kind === 'relative')).toBe(true);
  });
  it('rejects insecure sources and base elements; flags dynamic references for review', () => {
    expect(inspectHTML('<script src="http://cdn.test/a.js"></script>').acceptable).toBe(false);
    expect(inspectHTML('<base href="https://example.test">').acceptable).toBe(false);
    expect(inspectHTML('<script>fetch(endpoint)</script>').issues.some(i => i.kind === 'dynamic')).toBe(true);
  });
});
describe('verified content cache', () => {
  const bytes = utf8.encode('<h1>Hello</h1>');
  const item: DemoItem = { id: 'test', title: 'Test', filename: 'test.html', contentType: 'text/html', bytes: bytes.length, contentHash: ccc.hashCkb(bytes), capabilities: DEFAULT_CAPABILITIES, ckbfs: { protocol: CKBFS_PROTOCOL_V3, typeId } };
  it('rejects mismatch before caching; cached relaunch revalidates without RPC', async () => {
    const client = chainFixture([bytes]).client;
    vi.mocked(resolveV3).mockResolvedValue({ fileBytes: bytes, contentType: 'text/html', filename: 'test.html', size: bytes.length } as Awaited<ReturnType<typeof resolveV3>>);
    expect((await loadDemo(item, client)).cached).toBe(false); expect((await loadDemo(item, client, true)).cached).toBe(true); expect(resolveV3).toHaveBeenCalledTimes(1);
    const db = await proofDB(); const key = `${typeId}:${item.contentHash}`; const cached = await db.get('demos', key); await db.put('demos', { ...cached, bytes: new Uint8Array(bytes.length) }, key);
    await expect(loadDemo(item, client, true)).rejects.toThrow('CONTENT_HASH_MISMATCH');
  });
  it('rejects an offline cache miss and a content identity mismatch', async () => {
    await expect(loadDemo(item, chainFixture([bytes]).client, true)).rejects.toThrow('OFFLINE_NOT_CACHED');
    expect(() => verifyDemo(new Uint8Array(), item)).toThrow('BYTE_LENGTH_MISMATCH');
  });
});
