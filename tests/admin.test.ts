import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { advanceDraft, confirmPreview, createDraft, getDraft, inspectDraft, saveDraft, signDraftAction } from '../src/admin/draft';
import { proofDB } from '../src/proof/journal';
import { DEFAULT_CAPABILITIES } from '../src/player/policy';
import { chainFixture, lock, typeId } from './fixtures';
import { utf8 } from '../src/ckbfs/codec';
import { initialManifest, manifestBytes } from '../src/registry/manifest';
import { findRegistry, assertRegistryOwner, assertRegistryUnchanged, prepareRegistryUpdate, broadcastRegistry, verifyRegistryCommit, type RegistryState } from '../src/registry/registry';
import { prepareV3, broadcastPreparedV3 } from '../src/ckbfs/publisher';
import { resolveV3 } from '../src/ckbfs/resolver';
import { resolveManifest } from '../src/registry/manifest';
vi.mock('../src/registry/registry', async original => ({ ...await original<typeof import('../src/registry/registry')>(), findRegistry: vi.fn(), assertRegistryOwner: vi.fn(async () => lock), assertRegistryUnchanged: vi.fn(), prepareRegistryUpdate: vi.fn(), broadcastRegistry: vi.fn(), verifyRegistryCommit: vi.fn() }));
vi.mock('../src/ckbfs/publisher', () => ({ prepareV3: vi.fn(), broadcastPreparedV3: vi.fn() }));
vi.mock('../src/ckbfs/resolver', () => ({ resolveV3: vi.fn() }));
vi.mock('../src/registry/manifest', async original => ({ ...await original<typeof import('../src/registry/manifest')>(), resolveManifest: vi.fn() }));
const bytes = utf8.encode('<h1>Demo</h1>'); const fixture = chainFixture([bytes]);
const registry: RegistryState = { typeId, cell: fixture.cell(), data: { version: 1, revision: 1n, manifestTypeId: typeId, manifestHash: typeId } };
const metadata = { id: 'demo-1', title: 'Demo', description: '', category: 'Experiments', tags: [], capabilities: DEFAULT_CAPABILITIES };
const receipt = { typeId, txHash: fixture.transactions[0].hash(), transaction: ccc.hexFrom(fixture.transactions[0].toBytes()), verified: false };
const signer = { client: fixture.client } as ccc.Signer;
beforeEach(async () => { await (await proofDB()).clear('adminDrafts'); vi.clearAllMocks(); vi.mocked(findRegistry).mockResolvedValue(registry); });
async function readyDraft() { let d = await createDraft('demo.html', bytes, metadata, registry); d = (await inspectDraft(d)).draft; return confirmPreview(d); }
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
