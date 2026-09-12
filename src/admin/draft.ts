import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { CKBFS_PROTOCOL_V3 } from '../../config/ckbfs-v3';
import { proofDB } from '../proof/journal';
import { createPudgeClient } from '../ckbfs/client';
import { invariant, formatDiagnostic } from '../ckbfs/errors';
import { prepareV3, broadcastPreparedV3, type PreparedV3 } from '../ckbfs/publisher';
import { resolveV3 } from '../ckbfs/resolver';
import { inspectHTML, type PortabilityReport } from '../player/portability';
import { capabilitiesSchema, manifestBytes, nextManifest, resolveManifest, type ManifestPointer } from '../registry/manifest';
import { assertRegistryOwner, assertRegistryUnchanged, broadcastRegistry, findRegistry, prepareRegistryUpdate, registryPointer, verifyRegistryCommit, type RegistryState, type PreparedRegistry, type SignedRegistry } from '../registry/registry';
const hash = z.string().regex(/^0x[\da-f]{64}$/); const hex = z.string().regex(/^0x(?:[\da-f]{2})*$/);
export const stages = ['IDLE', 'FILE_SELECTED', 'INSPECTED', 'PREVIEW_OK', 'DEMO_PUBLISHING', 'DEMO_PUBLISHED', 'DEMO_VERIFYING', 'DEMO_VERIFIED', 'MANIFEST_BUILDING', 'MANIFEST_PUBLISHING', 'MANIFEST_PUBLISHED', 'MANIFEST_VERIFYING', 'MANIFEST_VERIFIED', 'REGISTRY_UPDATING', 'REGISTRY_VERIFYING', 'COMPLETE', 'ERROR_RECOVERABLE', 'ERROR_FATAL'] as const;
const receiptSchema = z.object({ typeId: hash, txHash: hash, transaction: hex, verified: z.boolean() });
export const draftSchema = z.object({
  draftId: z.string(), stage: z.enum(stages), updatedAt: z.string(), version: z.number().int().nonnegative(),
  local: z.object({ filename: z.string().min(1), content: hex, contentHash: hash, bytes: z.number().int().nonnegative(),
    metadata: z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string(), category: z.string().min(1), tags: z.array(z.string()), capabilities: capabilitiesSchema }) }),
  inspected: z.boolean(), previewed: z.boolean(),
  expected: z.object({ typeId: hash, txHash: hash, index: z.string(), revision: z.string(), lockHash: hash, manifestTypeId: hash, manifestHash: hash }),
  demo: receiptSchema.optional(), manifest: z.object({ content: hex, contentHash: hash, revision: z.number(), receipt: receiptSchema.optional() }).optional(),
  registry: z.object({ txHash: hash, typeId: hash, transaction: hex, data: z.object({ version: z.literal(1), revision: z.string(), manifestTypeId: hash, manifestHash: hash }), previousOutPoint: z.object({ txHash: hash, index: z.string() }).optional() }).optional(), error: z.string().optional(),
});
export type PublishDraft = z.infer<typeof draftSchema>;
export type DraftMetadata = PublishDraft['local']['metadata'];
export type DraftAction = { kind: 'demo' | 'manifest'; draftId: string; prepared: PreparedV3 } | { kind: 'registry'; draftId: string; prepared: PreparedRegistry };
export async function allDrafts(): Promise<PublishDraft[]> { return z.array(draftSchema).parse(await (await proofDB()).get('adminDrafts', 'publish-drafts') ?? []); }
export async function getDraft(id: string) { const draft = (await allDrafts()).find(d => d.draftId === id); invariant(draft, 'MISSING_DRAFT', 'Publish draft is not available on this browser origin.'); return draft; }
export async function saveDraft(draft: PublishDraft): Promise<PublishDraft> {
  draftSchema.parse(draft); const tx = (await proofDB()).transaction('adminDrafts', 'readwrite'); const all = z.array(draftSchema).parse(await tx.store.get('publish-drafts') ?? []); const prior = all.find(d => d.draftId === draft.draftId);
  invariant(!prior || prior.version === draft.version, 'DRAFT_CHANGED', 'Another action changed this draft. Reload it before continuing.');
  for (const [oldReceipt, newReceipt] of [[prior?.demo, draft.demo], [prior?.manifest?.receipt, draft.manifest?.receipt], [prior?.registry, draft.registry]]) invariant(!oldReceipt || oldReceipt.txHash === newReceipt?.txHash, 'DUPLICATE_UPLOAD_BLOCKED', 'A signed transaction cannot be discarded or replaced during recovery.');
  const next = { ...draft, version: draft.version + 1, updatedAt: new Date().toISOString() }; await tx.store.put([...all.filter(d => d.draftId !== draft.draftId), next], 'publish-drafts'); await tx.done; return next;
}
export async function createDraft(filename: string, bytes: Uint8Array, metadata: DraftMetadata, registry: RegistryState) {
  invariant(/\.html?$/i.test(filename), 'UNSUPPORTED_CONTENT_TYPE', 'Select a single HTML file.');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return saveDraft({ draftId: crypto.randomUUID(), stage: 'FILE_SELECTED', version: 0, updatedAt: new Date().toISOString(), local: { filename, content: ccc.hexFrom(bytes), contentHash: ccc.hashCkb(bytes), bytes: bytes.length, metadata }, inspected: false, previewed: false,
    expected: { typeId: registry.typeId, txHash: registry.cell.outPoint.txHash, index: ccc.numToHex(registry.cell.outPoint.index), revision: registry.data.revision.toString(), lockHash: registry.cell.cellOutput.lock.hash(), manifestTypeId: registry.data.manifestTypeId, manifestHash: registry.data.manifestHash } });
}
export async function inspectDraft(draft: PublishDraft): Promise<{ draft: PublishDraft; report: PortabilityReport }> {
  const report = inspectHTML(new TextDecoder('utf-8', { fatal: true }).decode(ccc.bytesFrom(draft.local.content)));
  invariant(report.acceptable, 'RELATIVE_DEPENDENCIES', report.issues.filter(i => i.kind !== 'dynamic').map(i => `${i.source}: ${i.value}`).join('\n'));
  invariant(!report.externalUrls.length || draft.local.metadata.capabilities.network, 'NETWORK_CAPABILITY_REQUIRED', 'This file references HTTPS resources. Approve network access before creating the draft.');
  const saved = await saveDraft({ ...draft, inspected: true, stage: 'INSPECTED' }); return { draft: saved, report };
}
export async function confirmPreview(draft: PublishDraft) { invariant(draft.inspected, 'INSPECTION_REQUIRED', 'Inspect portability before preview approval.'); return saveDraft({ ...draft, previewed: true, stage: 'PREVIEW_OK' }); }
async function currentRegistry(draft: PublishDraft, signer: ccc.Signer) {
  const state = await findRegistry(draft.expected.typeId, signer.client); await assertRegistryOwner(signer, state);
  invariant(state.cell.outPoint.txHash === draft.expected.txHash && ccc.numToHex(state.cell.outPoint.index) === draft.expected.index && state.data.revision.toString() === draft.expected.revision && state.cell.cellOutput.lock.hash() === draft.expected.lockHash && state.data.manifestTypeId === draft.expected.manifestTypeId && state.data.manifestHash === draft.expected.manifestHash,
    'REGISTRY_CHANGED', 'The registry changed during this draft. Published artifacts are retained; no upload will be repeated. Review current state before starting a new catalog transition.'); return state;
}
/** Advances one safe stage. A returned action requires a separate, explicit UI signature action. */
export async function advanceDraft(id: string, signer: ccc.Signer): Promise<{ draft: PublishDraft; action?: DraftAction }> {
  let draft = await getDraft(id);
  try {
    invariant(draft.previewed && draft.inspected, 'PREVIEW_REQUIRED', 'Inspect and approve the production-sandbox preview first.');
    const content = ccc.bytesFrom(draft.local.content); invariant(ccc.hashCkb(content) === draft.local.contentHash, 'DRAFT_CORRUPT', 'Draft source bytes do not match their hash.');
    if (draft.stage === 'COMPLETE') return { draft };
    if (!draft.demo) {
      await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'DEMO_PUBLISHING', error: undefined });
      return { draft, action: { kind: 'demo', draftId: id, prepared: await prepareV3({ signer, content, filename: draft.local.filename, contentType: 'text/html; charset=utf-8' }) } };
    }
    if (!draft.demo.verified) {
      draft = await saveDraft({ ...draft, stage: 'DEMO_VERIFYING', error: undefined });
      const result = await resolveV3(draft.demo!.typeId, { client: createPudgeClient() });
      invariant(result.currentOutPoint.txHash === draft.demo!.txHash && ccc.hexFrom(result.fileBytes) === draft.local.content && ccc.hashCkb(result.fileBytes) === draft.local.contentHash, 'CONTENT_HASH_MISMATCH', 'Independently resolved demo differs from the selected bytes.');
      return { draft: await saveDraft({ ...draft, demo: { ...draft.demo!, verified: true }, stage: 'DEMO_VERIFIED' }) };
    }
    if (!draft.manifest) {
      const registry = await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'MANIFEST_BUILDING', error: undefined });
      const current = await resolveManifest(registryPointer(registry), createPudgeClient());
      const item = { ...draft.local.metadata, ckbfs: { protocol: CKBFS_PROTOCOL_V3, typeId: draft.demo!.typeId, txHash: draft.demo!.txHash }, contentHash: draft.local.contentHash, filename: draft.local.filename, contentType: 'text/html; charset=utf-8', bytes: draft.local.bytes, createdAt: new Date().toISOString(), status: 'active' as const };
      invariant(!current.manifest.items.some(i => i.id === item.id), 'DUPLICATE_ITEM_ID', 'Item ID already exists; choose a distinct ID for this new demo.');
      const manifest = nextManifest(current, registry.data.revision, [...current.manifest.items, item]); const bytes = manifestBytes(manifest);
      draft = await saveDraft({ ...draft, manifest: { content: ccc.hexFrom(bytes), contentHash: ccc.hashCkb(bytes), revision: manifest.revision } });
    }
    if (!draft.manifest!.receipt) {
      await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'MANIFEST_PUBLISHING', error: undefined });
      return { draft, action: { kind: 'manifest', draftId: id, prepared: await prepareV3({ signer, content: ccc.bytesFrom(draft.manifest!.content), filename: `jukebox-manifest-${draft.manifest!.revision}.json`, contentType: 'application/json; charset=utf-8' }) } };
    }
    if (!draft.manifest!.receipt!.verified) {
      draft = await saveDraft({ ...draft, stage: 'MANIFEST_VERIFYING', error: undefined });
      const result = await resolveManifest({ typeId: draft.manifest!.receipt!.typeId, contentHash: draft.manifest!.contentHash }, createPudgeClient());
      invariant(result.txHash === draft.manifest!.receipt!.txHash && ccc.hexFrom(result.bytes) === draft.manifest!.content, 'MANIFEST_HASH_MISMATCH', 'Independent manifest bytes differ from the draft.');
      return { draft: await saveDraft({ ...draft, stage: 'MANIFEST_VERIFIED', manifest: { ...draft.manifest!, receipt: { ...draft.manifest!.receipt!, verified: true } } }) };
    }
    if (!draft.registry) {
      const registry = await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'REGISTRY_UPDATING', error: undefined });
      return { draft, action: { kind: 'registry', draftId: id, prepared: await prepareRegistryUpdate(signer, registry, { typeId: draft.manifest!.receipt!.typeId, contentHash: draft.manifest!.contentHash }) } };
    }
    draft = await saveDraft({ ...draft, stage: 'REGISTRY_VERIFYING', error: undefined });
    await verifyRegistryCommit(draft.registry as SignedRegistry, createPudgeClient());
    return { draft: await saveDraft({ ...draft, stage: 'COMPLETE' }) };
  } catch (error) {
    const latest = await getDraft(id); await saveDraft({ ...latest, stage: 'ERROR_RECOVERABLE', error: formatDiagnostic(error) }); throw error;
  }
}
export async function signDraftAction(action: DraftAction, signer: ccc.Signer) {
  let draft = await getDraft(action.draftId); const registry = await currentRegistry(draft, signer); await assertRegistryUnchanged(registry, signer.client);
  if (action.kind === 'registry') {
    invariant(!draft.registry, 'DUPLICATE_UPLOAD_BLOCKED', 'Recover the already-signed registry transaction.');
    await broadcastRegistry(action.prepared, signer, async signed => { draft = await saveDraft({ ...draft, registry: signed, stage: 'REGISTRY_VERIFYING' }); });
  } else {
    invariant(action.kind === 'demo' ? !draft.demo : !draft.manifest?.receipt, 'DUPLICATE_UPLOAD_BLOCKED', 'This content was already signed. Resolve or recover the known transaction.');
    await broadcastPreparedV3(action.prepared, { signer, persistSigned: async signed => {
      const receipt = { typeId: signed.typeId, txHash: signed.txHash, transaction: signed.transaction, verified: false };
      draft = await saveDraft(action.kind === 'demo' ? { ...draft, demo: receipt, stage: 'DEMO_PUBLISHED' } : { ...draft, manifest: { ...draft.manifest!, receipt }, stage: 'MANIFEST_PUBLISHED' });
    } });
  }
  return getDraft(action.draftId);
}
export async function recoverDraftTransaction(id: string, signer: ccc.Signer) {
  const draft = await getDraft(id); await assertRegistryOwner(signer);
  const receipt = draft.registry ?? draft.manifest?.receipt ?? draft.demo; invariant(receipt, 'MISSING_TRANSACTION', 'No signed transaction to recover. Prepare the next action.');
  const tx = ccc.Transaction.fromBytes(receipt.transaction); invariant(tx.hash() === receipt.txHash, 'DRAFT_CORRUPT', 'Signed transaction hash does not match persisted bytes.');
  const response = await signer.client.getTransactionNoCache(receipt.txHash);
  if (draft.registry) {
    const current = await findRegistry(draft.expected.typeId, signer.client);
    if (current.cell.outPoint.txHash === draft.registry.txHash) return advanceDraft(id, signer);
    await currentRegistry(draft, signer);
  }
  if (!response || !['committed', 'pending', 'proposed'].includes(response.status)) await signer.client.sendTransaction(tx);
  return { draft: await getDraft(id) };
}
