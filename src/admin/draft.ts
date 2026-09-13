import * as ccc from '@ckb-ccc/core';
import { z } from 'zod';
import { CKBFS_PROTOCOL_V3 } from '../../config/ckbfs-v3';
import { validateScreenshot, type OptimizedScreenshot } from '../screenshots/image';
import { proofDB } from '../proof/journal';
import { createPudgeClient, findLiveV3 } from '../ckbfs/client';
import { invariant, formatDiagnostic } from '../ckbfs/errors';
import { prepareV3, broadcastPreparedV3, type PreparedV3 } from '../ckbfs/publisher';
import { prepareV3Segment, SEGMENT_BYTES, MAX_FILE_BYTES } from '../ckbfs/segments';
import { resolveUploadedFile } from './resolve-upload';
import { inspectHTML, type PortabilityReport } from '../player/portability';
import { capabilitiesSchema, itemSchema, type Manifest, manifestBytes, nextManifest, resolveManifest, type ManifestPointer } from '../registry/manifest';
import { assertRegistryOwner, assertRegistryUnchanged, broadcastRegistry, findRegistry, prepareRegistryUpdate, registryPointer, verifyRegistryCommit, type RegistryState, type PreparedRegistry, type SignedRegistry } from '../registry/registry';
const hash = z.string().regex(/^0x[\da-f]{64}$/); const hex = z.string().regex(/^0x(?:[\da-f]{2})*$/);
export const stages = ['IDLE', 'FILE_SELECTED', 'INSPECTED', 'PREVIEW_OK', 'DEMO_PUBLISHING', 'DEMO_PUBLISHED', 'DEMO_VERIFYING', 'DEMO_VERIFIED', 'SCREENSHOT_PUBLISHING', 'SCREENSHOT_PUBLISHED', 'SCREENSHOT_VERIFYING', 'SCREENSHOT_VERIFIED', 'MANIFEST_BUILDING', 'MANIFEST_PUBLISHING', 'MANIFEST_PUBLISHED', 'MANIFEST_VERIFYING', 'MANIFEST_VERIFIED', 'REGISTRY_UPDATING', 'REGISTRY_VERIFYING', 'COMPLETE', 'ERROR_RECOVERABLE', 'ERROR_FATAL'] as const;
const receiptSchema = z.object({ typeId: hash, txHash: hash, transaction: hex, verified: z.boolean() });
export const draftSchema = z.object({
  draftId: z.string(), stage: z.enum(stages), updatedAt: z.string(), version: z.number().int().nonnegative(),
  local: z.object({ filename: z.string().min(1), content: hex, contentHash: hash, bytes: z.number().int().nonnegative(),
    screenshot: z.object({ filename: z.string(), content: hex, contentHash: hash, bytes: z.number().int().positive().max(48 * 1024), contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']), width: z.number().int().positive().max(960), height: z.number().int().positive().max(960), originalBytes: z.number().int().positive() }).optional(),
    metadata: z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string(), category: z.string().min(1), tags: z.array(z.string()), capabilities: capabilitiesSchema }) }),
  screenshotFor: itemSchema.optional(),
  inspected: z.boolean(), previewed: z.boolean(),
  expected: z.object({ typeId: hash, txHash: hash, index: z.string(), revision: z.string(), lockHash: hash, manifestTypeId: hash, manifestHash: hash }),
  demoSegments: z.array(receiptSchema.extend({ start: z.number().int().nonnegative(), end: z.number().int().positive() })).optional(),
  screenshot: receiptSchema.optional(),
  demo: receiptSchema.optional(), manifest: z.object({ content: hex, contentHash: hash, revision: z.number(), receipt: receiptSchema.optional() }).optional(),
  registry: z.object({ txHash: hash, typeId: hash, transaction: hex, data: z.object({ version: z.literal(1), revision: z.string(), manifestTypeId: hash, manifestHash: hash }), previousOutPoint: z.object({ txHash: hash, index: z.string() }).optional() }).optional(), error: z.string().optional(),
});
export type PublishDraft = z.infer<typeof draftSchema>;
export type DraftMetadata = PublishDraft['local']['metadata'];
export type DraftAction = { kind: 'demo-segment'; draftId: string; prepared: PreparedV3; start: number; end: number; segmentIndex: number } | { kind: 'demo' | 'screenshot' | 'manifest'; draftId: string; prepared: PreparedV3 } | { kind: 'registry'; draftId: string; prepared: PreparedRegistry };
export async function allDrafts(): Promise<PublishDraft[]> { return z.array(draftSchema).parse(await (await proofDB()).get('adminDrafts', 'publish-drafts') ?? []); }
export async function getDraft(id: string) { const draft = (await allDrafts()).find(d => d.draftId === id); invariant(draft, 'MISSING_DRAFT', 'Publish draft is not available on this browser origin.'); return draft; }
function sameJSON(a: unknown, b: unknown) {
  const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return stable(a) === stable(b);
}
export async function saveDraft(draft: PublishDraft): Promise<PublishDraft> {
  draft = draftSchema.parse(draft); const tx = (await proofDB()).transaction('adminDrafts', 'readwrite'); const all = z.array(draftSchema).parse(await tx.store.get('publish-drafts') ?? []); const prior = all.find(d => d.draftId === draft.draftId);
  invariant(!prior || prior.version === draft.version, 'DRAFT_CHANGED', 'Another action changed this draft. Reload it before continuing.');
  for (const [oldReceipt, newReceipt] of [[prior?.screenshot, draft.screenshot], [prior?.demo, draft.demo], [prior?.manifest?.receipt, draft.manifest?.receipt], [prior?.registry, draft.registry]]) invariant(!oldReceipt || oldReceipt.txHash === newReceipt?.txHash, 'DUPLICATE_UPLOAD_BLOCKED', 'A signed transaction cannot be discarded or replaced during recovery.');
  invariant(!prior || sameJSON(prior.screenshotFor, draft.screenshotFor), 'DRAFT_CHANGED', 'The existing demo selected for screenshot update cannot change.');
  invariant(!prior || sameJSON(prior.local.screenshot, draft.local.screenshot), 'DRAFT_CHANGED', 'The approved screenshot cannot be changed inside a saved draft.');
  invariant(!prior?.screenshot || prior.screenshot.typeId === draft.screenshot?.typeId && prior.screenshot.transaction === draft.screenshot?.transaction && (!prior.screenshot.verified || draft.screenshot?.verified), 'DUPLICATE_UPLOAD_BLOCKED', 'A signed screenshot cannot be replaced or unverified.');
  const segments = draft.demoSegments ?? [];
  for (let i = 0; i < (prior?.demoSegments?.length ?? 0); i++) {
    const old = prior!.demoSegments![i], next = segments[i];
    invariant(next && old.txHash === next.txHash && old.typeId === next.typeId && old.transaction === next.transaction && old.start === next.start && old.end === next.end && (!old.verified || next.verified), 'DUPLICATE_UPLOAD_BLOCKED', 'Signed segments cannot be discarded, replaced or unverified.');
  }
  segments.forEach((segment, i) => invariant(segment.start === (i ? segments[i - 1].end : 0) && segment.end > segment.start && segment.end <= draft.local.bytes && (!i || segments[i - 1].verified && segment.typeId === segments[0].typeId), 'INVALID_SEGMENT', 'Segments must form a contiguous, verified history under one Type ID.'));
  const next = { ...draft, version: draft.version + 1, updatedAt: new Date().toISOString() }; await tx.store.put([...all.filter(d => d.draftId !== draft.draftId), next], 'publish-drafts'); await tx.done; return next;
}
export async function createDraft(filename: string, bytes: Uint8Array, metadata: DraftMetadata, registry: RegistryState, screenshot?: OptimizedScreenshot, screenshotFor?: Manifest['items'][number]) {
  invariant(/\.html?$/i.test(filename), 'UNSUPPORTED_CONTENT_TYPE', 'Select a single HTML file.');
  invariant(bytes.length <= MAX_FILE_BYTES, 'CONTENT_TOO_LARGE', 'The complete HTML file exceeds the 32 MiB resolver limit.');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  invariant(!screenshotFor || screenshot, 'SCREENSHOT_REQUIRED', 'Choose a screenshot to update this demo.');
  if (screenshotFor) itemSchema.parse(screenshotFor);
  if (screenshot) validateScreenshot(screenshot.bytes, screenshot.contentType);
  return saveDraft({ draftId: crypto.randomUUID(), stage: screenshotFor ? 'PREVIEW_OK' : 'FILE_SELECTED', version: 0, updatedAt: new Date().toISOString(), local: { filename, content: ccc.hexFrom(bytes), contentHash: ccc.hashCkb(bytes), bytes: bytes.length, metadata, screenshot: screenshot ? { ...screenshot, bytes: screenshot.bytes.length, content: ccc.hexFrom(screenshot.bytes), contentHash: ccc.hashCkb(screenshot.bytes) } : undefined }, screenshotFor, inspected: !!screenshotFor, previewed: !!screenshotFor,
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
    if (!draft.screenshotFor && !draft.demo && (content.length > SEGMENT_BYTES || draft.demoSegments?.length)) {
      await currentRegistry(draft, signer);
      const segments = draft.demoSegments ?? [], latest = segments.at(-1);
      if (latest && !latest.verified) {
        draft = await saveDraft({ ...draft, stage: 'DEMO_VERIFYING', error: undefined });
        const result = await resolveUploadedFile(latest, createPudgeClient());
        invariant(result.currentOutPoint.txHash === latest.txHash && ccc.hexFrom(result.fileBytes) === ccc.hexFrom(content.slice(0, latest.end)), 'CONTENT_HASH_MISMATCH', 'Resolved segment history differs from the selected file prefix.');
        const complete = latest.end === content.length;
        invariant(!complete || ccc.hashCkb(result.fileBytes) === draft.local.contentHash, 'CONTENT_HASH_MISMATCH', 'Complete file hash does not match the selected HTML.');
        const verified = { ...latest, verified: true };
        return { draft: await saveDraft({ ...draft, demoSegments: [...segments.slice(0, -1), verified], demo: complete ? verified : undefined, stage: complete ? 'DEMO_VERIFIED' : 'DEMO_PUBLISHED' }) };
      }
      let prior: ccc.Cell | undefined;
      if (latest) {
        const result = await resolveUploadedFile(latest, createPudgeClient());
        invariant(result.currentOutPoint.txHash === latest.txHash && ccc.hexFrom(result.fileBytes) === ccc.hexFrom(content.slice(0, latest.end)), 'CELL_CHANGED', 'The uploaded prefix changed. Keep this draft and inspect its transaction history.');
        prior = await findLiveV3(signer.client, latest.typeId);
        invariant(prior.outPoint.txHash === latest.txHash && prior.outPoint.index === 0n, 'CELL_CHANGED', 'CKBFS head changed while preparing the next append.');
      }
      draft = await saveDraft({ ...draft, stage: 'DEMO_PUBLISHING', error: undefined });
      const segment = await prepareV3Segment({ signer, content, filename: draft.local.filename, contentType: 'text/html; charset=utf-8' }, latest?.end ?? 0, prior);
      return { draft, action: { kind: 'demo-segment', draftId: id, ...segment, segmentIndex: segments.length } };
    }
    if (!draft.screenshotFor && !draft.demo) {
      await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'DEMO_PUBLISHING', error: undefined });
      return { draft, action: { kind: 'demo', draftId: id, prepared: await prepareV3({ signer, content, filename: draft.local.filename, contentType: 'text/html; charset=utf-8' }) } };
    }
    if (!draft.screenshotFor && !draft.demo!.verified) {
      draft = await saveDraft({ ...draft, stage: 'DEMO_VERIFYING', error: undefined });
      const result = await resolveUploadedFile(draft.demo!, createPudgeClient());
      invariant(result.currentOutPoint.txHash === draft.demo!.txHash && ccc.hexFrom(result.fileBytes) === draft.local.content && ccc.hashCkb(result.fileBytes) === draft.local.contentHash, 'CONTENT_HASH_MISMATCH', 'Independently resolved demo differs from the selected bytes.');
      return { draft: await saveDraft({ ...draft, demo: { ...draft.demo!, verified: true }, stage: 'DEMO_VERIFIED' }) };
    }
    if (draft.screenshotFor && !draft.manifest) {
      const registry = await currentRegistry(draft, signer);
      const catalog = await resolveManifest(registryPointer(registry), createPudgeClient());
      invariant(sameJSON(catalog.manifest.items.find(item => item.id === draft.screenshotFor!.id), draft.screenshotFor), 'REGISTRY_CHANGED', 'The existing demo differs from the selected verified catalog. Keep the saved screenshot and inspect the registry.');
    }
    if (draft.local.screenshot) {
      const screenshot = draft.local.screenshot; const image = ccc.bytesFrom(screenshot.content);
      validateScreenshot(image, screenshot.contentType);
      invariant(ccc.hashCkb(image) === screenshot.contentHash && image.length === screenshot.bytes, 'DRAFT_CORRUPT', 'Saved screenshot bytes/hash differ.');
      if (!draft.screenshot) {
        await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'SCREENSHOT_PUBLISHING', error: undefined });
        return { draft, action: { kind: 'screenshot', draftId: id, prepared: await prepareV3({ signer, content: image, filename: screenshot.filename, contentType: screenshot.contentType }) } };
      }
      if (!draft.screenshot.verified) {
        draft = await saveDraft({ ...draft, stage: 'SCREENSHOT_VERIFYING', error: undefined });
        const result = await resolveUploadedFile(draft.screenshot!, createPudgeClient());
        validateScreenshot(result.fileBytes, result.contentType);
        invariant(result.contentType === screenshot.contentType && ccc.hexFrom(result.fileBytes) === screenshot.content && ccc.hashCkb(result.fileBytes) === screenshot.contentHash, 'CONTENT_HASH_MISMATCH', 'Independently resolved screenshot differs from the approved image.');
        return { draft: await saveDraft({ ...draft, screenshot: { ...draft.screenshot!, verified: true }, stage: 'SCREENSHOT_VERIFIED' }) };
      }
    }
    if (!draft.manifest) {
      const registry = await currentRegistry(draft, signer); draft = await saveDraft({ ...draft, stage: 'MANIFEST_BUILDING', error: undefined });
      const current = await resolveManifest(registryPointer(registry), createPudgeClient());
      const shot = draft.local.screenshot;
      const screenshot = shot && draft.screenshot?.verified ? { ckbfs: { protocol: CKBFS_PROTOCOL_V3, typeId: draft.screenshot.typeId, txHash: draft.screenshot.txHash }, contentHash: shot.contentHash, filename: shot.filename, contentType: shot.contentType, bytes: shot.bytes, width: shot.width, height: shot.height } : undefined;
      const item = draft.screenshotFor ? { ...draft.screenshotFor, screenshot } : { ...draft.local.metadata, ...(screenshot ? { screenshot } : {}), ckbfs: { protocol: CKBFS_PROTOCOL_V3, typeId: draft.demo!.typeId, txHash: draft.demo!.txHash }, contentHash: draft.local.contentHash, filename: draft.local.filename, contentType: 'text/html; charset=utf-8', bytes: draft.local.bytes, createdAt: new Date().toISOString(), status: 'active' as const };
      invariant(draft.screenshotFor || !current.manifest.items.some(i => i.id === item.id), 'DUPLICATE_ITEM_ID', 'Item ID already exists; choose a distinct ID for this new demo.');
      const manifest = nextManifest(current, registry.data.revision, draft.screenshotFor ? current.manifest.items.map(existing => existing.id === item.id ? item : existing) : [...current.manifest.items, item]); const bytes = manifestBytes(manifest);
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
  } else if (action.kind === 'demo-segment') {
    const segments = draft.demoSegments ?? [], latest = segments.at(-1);
    invariant(!draft.demo && !draft.manifest && segments.length === action.segmentIndex && action.start === (latest?.end ?? 0) && action.end > action.start && action.end <= draft.local.bytes && (!latest || latest.verified && action.prepared.typeId === latest.typeId), 'DUPLICATE_UPLOAD_BLOCKED', 'This segment was already signed or the draft changed. Recover the saved transaction.');
    if (latest) {
      const live = await findLiveV3(signer.client, latest.typeId);
      invariant(live.outPoint.txHash === latest.txHash && live.outPoint.index === 0n && action.prepared.transaction.inputs.some(input => input.previousOutput.eq(live.outPoint)), 'CELL_CHANGED', 'CKBFS head changed before append signing.');
    }
    await broadcastPreparedV3(action.prepared, { signer, persistSigned: async signed => {
      const segment = { typeId: signed.typeId, txHash: signed.txHash, transaction: signed.transaction, verified: false, start: action.start, end: action.end };
      draft = await saveDraft({ ...draft, demoSegments: [...segments, segment], stage: 'DEMO_PUBLISHED' });
    } });
  } else if (action.kind === 'screenshot') {
    invariant((draft.demo?.verified || draft.screenshotFor) && draft.local.screenshot && !draft.screenshot && !draft.manifest, 'DUPLICATE_UPLOAD_BLOCKED', 'Recover the existing screenshot transaction; the demo must be verified first.');
    await broadcastPreparedV3(action.prepared, { signer, persistSigned: async signed => {
      draft = await saveDraft({ ...draft, screenshot: { typeId: signed.typeId, txHash: signed.txHash, transaction: signed.transaction, verified: false }, stage: 'SCREENSHOT_PUBLISHED' });
    } });
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
  const receipt = draft.registry ?? draft.manifest?.receipt ?? draft.screenshot ?? draft.demo ?? draft.demoSegments?.at(-1); invariant(receipt, 'MISSING_TRANSACTION', 'No signed transaction to recover. Prepare the next action.');
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
