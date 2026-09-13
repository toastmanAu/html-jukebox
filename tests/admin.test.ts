import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { advanceDraft, confirmPreview, createDraft, getDraft, inspectDraft, saveDraft, signDraftAction, recoverDraftTransaction } from '../src/admin/draft';
import { proofDB } from '../src/proof/journal';
import { DEFAULT_CAPABILITIES } from '../src/player/policy';
import { chainFixture, lock, typeId } from './fixtures';
import { utf8 } from '../src/ckbfs/codec';
import { initialManifest, manifestBytes } from '../src/registry/manifest';
import { findRegistry, assertRegistryOwner, assertRegistryUnchanged, prepareRegistryUpdate, broadcastRegistry, verifyRegistryCommit, type RegistryState } from '../src/registry/registry';
import { prepareV3, broadcastPreparedV3 } from '../src/ckbfs/publisher';
import { resolveV3 } from '../src/ckbfs/resolver';
import { SEGMENT_BYTES } from '../src/ckbfs/segments';
import { findLiveV3 } from '../src/ckbfs/client';
import { resolveManifest } from '../src/registry/manifest';
vi.mock('../src/registry/registry', async original => ({ ...await original<typeof import('../src/registry/registry')>(), findRegistry: vi.fn(), assertRegistryOwner: vi.fn(async () => lock), assertRegistryUnchanged: vi.fn(), prepareRegistryUpdate: vi.fn(), broadcastRegistry: vi.fn(), verifyRegistryCommit: vi.fn() }));
vi.mock('../src/ckbfs/publisher', () => ({ prepareV3: vi.fn(), broadcastPreparedV3: vi.fn() }));
vi.mock('../src/ckbfs/client',async original=>({...await original<typeof import('../src/ckbfs/client')>(),findLiveV3:vi.fn()}));
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
vi.mock('../src/admin/resolve-upload',()=>({resolveUploadedFile:(receipt: {typeId:string},client: unknown)=>resolveV3(receipt.typeId,{client:client as never})}));
vi.mock('../src/registry/manifest', async original => ({ ...await original<typeof import('../src/registry/manifest')>(), resolveManifest: vi.fn() }));
const bytes = utf8.encode('<h1>Demo</h1>'); const fixture = chainFixture([bytes]);
const registry: RegistryState = { typeId, cell: fixture.cell(), data: { version: 1, revision: 1n, manifestTypeId: typeId, manifestHash: typeId } };
const metadata = { id: 'demo-1', title: 'Demo', description: '', category: 'Experiments', tags: [], capabilities: DEFAULT_CAPABILITIES };
const receipt = { typeId, txHash: fixture.transactions[0].hash(), transaction: ccc.hexFrom(fixture.transactions[0].toBytes()), verified: false };
const signer = { client: fixture.client } as ccc.Signer;
beforeEach(async () => { await (await proofDB()).clear('adminDrafts'); vi.clearAllMocks(); vi.mocked(findRegistry).mockResolvedValue(registry); });
async function readyDraft(source=bytes) { let d = await createDraft('demo.html', source, metadata, registry); d = (await inspectDraft(d)).draft; return confirmPreview(d); }
describe('admin resumability and publication order', () => {
  it('requires inspection and explicit preview approval before any signature preparation', async () => {
    const d = await createDraft('demo.html', bytes, metadata, registry);
    await expect(advanceDraft(d.draftId, signer)).rejects.toThrow('PREVIEW_REQUIRED'); expect(prepareV3).not.toHaveBeenCalled();
    const relative = await createDraft('relative.html', utf8.encode('<img src="./x.png">'), metadata, registry);
    await expect(inspectDraft(relative)).rejects.toThrow('RELATIVE_DEPENDENCIES');
  });
  it('persists a successful demo receipt before an uncertain broadcast; resume only resolves it', async () => {
    const d = await readyDraft(); const prepared = { transaction: fixture.transactions[0], estimate: {}, typeId } as unknown as Awaited<ReturnType<typeof prepareV3>>;
    vi.mocked(prepareV3).mockResolvedValue(prepared);
    vi.mocked(broadcastPreparedV3).mockImplementation(async (_p, opts) => { await opts.persistSigned({ ...receipt, estimate: prepared.estimate }); throw new Error('RPC timeout after broadcast'); });
    const action = (await advanceDraft(d.draftId, signer)).action!;
    await expect(signDraftAction(action, signer)).rejects.toThrow('RPC timeout'); expect((await getDraft(d.draftId)).demo?.txHash).toBe(receipt.txHash);
    vi.mocked(resolveV3).mockResolvedValue({ fileBytes: bytes, currentOutPoint: { txHash: receipt.txHash } } as Awaited<ReturnType<typeof resolveV3>>);
    expect((await advanceDraft(d.draftId, signer)).draft.stage).toBe('DEMO_VERIFIED'); expect(prepareV3).toHaveBeenCalledTimes(1); expect(broadcastPreparedV3).toHaveBeenCalledTimes(1);
  });
  it('does not republish a manifest when registry verification fails', async () => {
    let d = await readyDraft(); const m = manifestBytes(initialManifest());
    d = await saveDraft({ ...d, demo: { ...receipt, verified: true }, manifest: { content: ccc.hexFrom(m), contentHash: ccc.hashCkb(m), revision: 2, receipt: { ...receipt, verified: true } }, registry: { ...receipt, data: { version: 1, revision: '2', manifestTypeId: typeId, manifestHash: typeId } } });
    vi.mocked(verifyRegistryCommit).mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(advanceDraft(d.draftId, signer)).rejects.toThrow('RPC unavailable'); expect((await getDraft(d.draftId)).stage).toBe('ERROR_RECOVERABLE');
    vi.mocked(verifyRegistryCommit).mockResolvedValue({ registry, manifest: {} } as Awaited<ReturnType<typeof verifyRegistryCommit>>);
    expect((await advanceDraft(d.draftId, signer)).draft.stage).toBe('COMPLETE'); expect(prepareV3).not.toHaveBeenCalled(); expect(broadcastPreparedV3).not.toHaveBeenCalled();
  });
  it('rejects stale registry while retaining verified demo bytes and receipt', async () => {
    let d = await readyDraft(); d = await saveDraft({ ...d, demo: { ...receipt, verified: true } });
    vi.mocked(findRegistry).mockResolvedValue({ ...registry, data: { ...registry.data, revision: 2n } });
    await expect(advanceDraft(d.draftId, signer)).rejects.toThrow('REGISTRY_CHANGED'); expect((await getDraft(d.draftId)).demo?.txHash).toBe(receipt.txHash); expect(prepareV3).not.toHaveBeenCalled();
  });
  it('prevents stale draft writes and removal of already signed uploads', async () => {
    const old = await readyDraft(); const next = await saveDraft({ ...old, demo: receipt });
    await expect(saveDraft(old)).rejects.toThrow('DRAFT_CHANGED'); await expect(saveDraft({ ...next, demo: undefined })).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
  });
});


describe('large demo durable append workflow',()=>{
  it('resumes an uncertain first broadcast, verifies its prefix, appends once, then verifies the full hash',async()=>{
    const source=utf8.encode('<h1>Large demo</h1>'.padEnd(SEGMENT_BYTES+111,' '));
    const chain=chainFixture([source.slice(0,SEGMENT_BYTES),source.slice(SEGMENT_BYTES)]);
    const s={client:chain.client} as ccc.Signer;
    const first=chain.transactions[0],last=chain.transactions[1];
    const p=(tx:ccc.Transaction)=>({transaction:tx,estimate:{bytes:1},typeId,witnessStart:1}) as Awaited<ReturnType<typeof prepareV3>>;
    let d=await readyDraft(source);d=await saveDraft({...d,stage:'ERROR_RECOVERABLE',error:'CONTENT_TOO_LARGE: previous single-transaction attempt'});vi.mocked(prepareV3).mockResolvedValueOnce(p(first)).mockResolvedValueOnce(p(last));
    vi.mocked(broadcastPreparedV3).mockImplementationOnce(async(prepared,opts)=>{await opts.persistSigned({typeId,txHash:first.hash(),transaction:ccc.hexFrom(first.toBytes()),estimate:prepared.estimate});throw Error('Uncertain broadcast');});
    const firstAction=(await advanceDraft(d.draftId,s)).action!;
    expect(firstAction.kind).toBe('demo-segment');await expect(signDraftAction(firstAction,s)).rejects.toThrow('Uncertain broadcast');
    expect((await getDraft(d.draftId)).demoSegments).toHaveLength(1);
    await expect(signDraftAction(firstAction,s)).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
    vi.mocked(resolveV3).mockResolvedValue({fileBytes:source.slice(0,SEGMENT_BYTES),currentOutPoint:{txHash:first.hash()}} as Awaited<ReturnType<typeof resolveV3>>);
    await advanceDraft(d.draftId,s);expect(prepareV3).toHaveBeenCalledTimes(1);expect((await getDraft(d.draftId)).demo).toBeUndefined();
    vi.mocked(findLiveV3).mockResolvedValue(ccc.Cell.from({outPoint:{txHash:first.hash(),index:0},cellOutput:first.outputs[0],outputData:first.outputsData[0]}));
    const secondAction=(await advanceDraft(d.draftId,s)).action!;expect(secondAction.kind).toBe('demo-segment');
    vi.mocked(broadcastPreparedV3).mockImplementationOnce(async(prepared,opts)=>{await opts.persistSigned({typeId,txHash:last.hash(),transaction:ccc.hexFrom(last.toBytes()),estimate:prepared.estimate});throw Error('Uncertain append broadcast');});
    await expect(signDraftAction(secondAction,s)).rejects.toThrow('Uncertain append broadcast');
    await expect(signDraftAction(secondAction,s)).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
    vi.mocked(resolveV3).mockResolvedValue({fileBytes:source,currentOutPoint:{txHash:last.hash()}} as Awaited<ReturnType<typeof resolveV3>>);
    const done=(await advanceDraft(d.draftId,s)).draft;expect(done.stage).toBe('DEMO_VERIFIED');expect(done.demo?.txHash).toBe(last.hash());expect(done.demoSegments?.every(x=>x.verified)).toBe(true);expect(done.manifest).toBeUndefined();
    await expect(saveDraft({...done,demoSegments:[]})).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
  });
  it('keeps the signed segment and blocks the manifest when resolved prefix bytes differ',async()=>{
    const source=utf8.encode('<h1>Large</h1>'.padEnd(SEGMENT_BYTES+1,' '));let d=await readyDraft(source);
    d=await saveDraft({...d,demoSegments:[{...receipt,start:0,end:SEGMENT_BYTES}]});
    vi.mocked(resolveV3).mockResolvedValue({fileBytes:bytes,currentOutPoint:{txHash:receipt.txHash}} as Awaited<ReturnType<typeof resolveV3>>);
    await expect(advanceDraft(d.draftId,signer)).rejects.toThrow('CONTENT_HASH_MISMATCH');const saved=await getDraft(d.draftId);expect(saved.demoSegments![0].verified).toBe(false);expect(saved.manifest).toBeUndefined();expect(prepareV3).not.toHaveBeenCalled();
  });
});

describe('durable screenshot publication', () => {
  const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const screenshot = { filename: 'screenshot.png', bytes: image, contentType: 'image/png' as const, width: 1, height: 1, originalBytes: image.length };
  async function ready() {
    let d = await createDraft('demo.html', bytes, metadata, registry, screenshot);
    d = (await inspectDraft(d)).draft; d = await confirmPreview(d);
    return saveDraft({ ...d, demo: { ...receipt, verified: true } });
  }
  it('persists an uncertain screenshot broadcast, blocks duplicate signing, and verifies before manifest creation', async () => {
    const d = await ready();
    const prepared = { transaction: fixture.transactions[0], estimate: {}, typeId } as Awaited<ReturnType<typeof prepareV3>>;
    vi.mocked(prepareV3).mockResolvedValue(prepared);
    const action = (await advanceDraft(d.draftId, signer)).action!;
    expect(action.kind).toBe('screenshot');
    expect(ccc.hexFrom(vi.mocked(prepareV3).mock.calls[0][0].content)).toBe(ccc.hexFrom(image));
    vi.mocked(broadcastPreparedV3).mockImplementationOnce(async (_p, opts) => { await opts.persistSigned({ ...receipt, estimate: prepared.estimate }); throw Error('uncertain screenshot broadcast'); });
    await expect(signDraftAction(action, signer)).rejects.toThrow('uncertain screenshot');
    await expect(signDraftAction(action, signer)).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
    const signed = await getDraft(d.draftId);
    await expect(saveDraft({ ...signed, screenshot: undefined })).rejects.toThrow('DUPLICATE_UPLOAD_BLOCKED');
    await recoverDraftTransaction(d.draftId, signer);
    vi.mocked(resolveV3).mockResolvedValue({ fileBytes: image, contentType: 'image/png', currentOutPoint: { txHash: receipt.txHash } } as Awaited<ReturnType<typeof resolveV3>>);
    const verified = (await advanceDraft(d.draftId, signer)).draft;
    expect(verified.screenshot?.verified).toBe(true); expect(prepareV3).toHaveBeenCalledTimes(1);
    const current = initialManifest(); vi.mocked(resolveManifest).mockResolvedValue({ manifest: current, pointer: { typeId, contentHash: typeId }, bytes: manifestBytes(current), txHash: receipt.txHash });
    const next = await advanceDraft(d.draftId, signer);
    expect(next.action?.kind).toBe('manifest');
    const manifest = JSON.parse(new TextDecoder().decode(ccc.bytesFrom(next.draft.manifest!.content)));
    expect(manifest.items[0].screenshot.contentHash).toBe(ccc.hashCkb(image));
    expect(manifest.items[0].ckbfs.txHash).toBe(receipt.txHash);
    expect(broadcastPreparedV3).toHaveBeenCalledTimes(1);
  });
  it('blocks the manifest on screenshot hash mismatch and retains both uploaded receipts', async () => {
    let d = await ready(); d = await saveDraft({ ...d, screenshot: receipt });
    const corrupt = image.slice(); corrupt[corrupt.length - 1] ^= 1;
    vi.mocked(resolveV3).mockResolvedValue({ fileBytes: corrupt, contentType: 'image/png', currentOutPoint: { txHash: receipt.txHash } } as Awaited<ReturnType<typeof resolveV3>>);
    await expect(advanceDraft(d.draftId, signer)).rejects.toThrow('CONTENT_HASH_MISMATCH');
    const saved = await getDraft(d.draftId); expect(saved.demo?.verified).toBe(true); expect(saved.screenshot?.txHash).toBe(receipt.txHash); expect(saved.manifest).toBeUndefined();
    expect(prepareV3).not.toHaveBeenCalled();
  });
  it('attaches a screenshot to an existing catalog item without publishing or changing its HTML', async () => {
    const existing = { ...metadata, filename: 'existing.html', bytes: bytes.length, contentHash: ccc.hashCkb(bytes), contentType: 'text/html', status: 'hidden' as const, ckbfs: { protocol: '20250821.4ee6689bf7ec' as const, typeId, txHash: receipt.txHash } };
    const current = { ...initialManifest(), items: [existing] };
    vi.mocked(resolveManifest).mockResolvedValue({ manifest: current, pointer: { typeId, contentHash: typeId }, bytes: manifestBytes(current), txHash: receipt.txHash });
    let d = await createDraft('existing.html', new Uint8Array(), metadata, registry, screenshot, existing);
    const prepared = { transaction: fixture.transactions[0], estimate: {}, typeId } as Awaited<ReturnType<typeof prepareV3>>; vi.mocked(prepareV3).mockResolvedValue(prepared);
    expect((await advanceDraft(d.draftId, signer)).action?.kind).toBe('screenshot');
    d = await getDraft(d.draftId); d = await saveDraft({ ...d, screenshot: { ...receipt, verified: true } });
    const next = await advanceDraft(d.draftId, signer);
    const updated = JSON.parse(new TextDecoder().decode(ccc.bytesFrom(next.draft.manifest!.content))).items;
    const { screenshot: shot, ...unchanged } = updated[0]; expect(unchanged).toEqual(existing); expect(shot.contentHash).toBe(ccc.hashCkb(image)); expect(updated).toHaveLength(1);
    expect(vi.mocked(prepareV3).mock.calls.map(c => c[0].contentType)).toEqual(['image/png', 'application/json; charset=utf-8']);
    // A committed registry is verified directly; do not reject it as an unexpected change to the old catalog.
    d = await saveDraft({ ...next.draft, manifest: { ...next.draft.manifest!, receipt: { ...receipt, verified: true } }, registry: { ...receipt, data: { version: 1, revision: '2', manifestTypeId: typeId, manifestHash: typeId } } });
    vi.mocked(findRegistry).mockResolvedValue({ ...registry, data: { ...registry.data, revision: 2n } });
    vi.mocked(verifyRegistryCommit).mockResolvedValue({ registry, manifest: {} } as Awaited<ReturnType<typeof verifyRegistryCommit>>);
    expect((await advanceDraft(d.draftId, signer)).draft.stage).toBe('COMPLETE');
  });
});
