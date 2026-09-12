import { useEffect, useState } from 'react';
import * as ckb from '@ckb-ccc/core';
import { ccc } from '@ckb-ccc/connector-react';
import { JUKEBOX_CONFIG } from '../../config/jukebox';
import { createPudgeClient } from '../ckbfs/client';
import { formatDiagnostic, invariant } from '../ckbfs/errors';
import { registryRecords } from '../registry/journal';
import { assertRegistryOwner, findRegistry, type RegistryState } from '../registry/registry';
import { DEFAULT_CAPABILITIES, type DemoCapabilities } from '../player/policy';
import { inspectHTML, type PortabilityReport } from '../player/portability';
import { Player } from '../player/Player';
import { SEGMENT_BYTES } from '../ckbfs/segments';
import { advanceDraft, allDrafts, confirmPreview, createDraft, inspectDraft, recoverDraftTransaction, signDraftAction, type DraftAction, type PublishDraft } from './draft';
export function AdminPanel() {
  const signer = ccc.useSigner(); const [registry, setRegistry] = useState<RegistryState>(); const [drafts, setDrafts] = useState<PublishDraft[]>([]); const [selected, setSelected] = useState('');
  const [file, setFile] = useState<{ filename: string; bytes: Uint8Array }>(); const [report, setReport] = useState<PortabilityReport>();
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [category, setCategory] = useState('Experiments'), [tags, setTags] = useState('');
  const [caps, setCaps] = useState<DemoCapabilities>(DEFAULT_CAPABILITIES), [dynamicReviewed, setDynamicReviewed] = useState(false);
  const [preview, setPreview] = useState(false), [previewSeen, setPreviewSeen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<{ action: DraftAction; signer: ckb.Signer }>(); const [status, setStatus] = useState('Load the owner registry to enable publishing. Local sandbox preview is available without a wallet.');
  const current = drafts.find(d => d.draftId === selected);
  useEffect(() => { allDrafts().then(setDrafts).catch(e => setError(formatDiagnostic(e))); }, []);
  useEffect(() => { setRegistry(undefined); setPending(undefined); }, [signer]);
  async function action(work: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { invariant(window.isSecureContext && navigator.locks, 'UNSUPPORTED_CONTEXT', 'Use a secure browser with Web Locks and IndexedDB.'); await navigator.locks.request('ckbfs-phase-1-proof', { ifAvailable: true }, async lock => { invariant(lock, 'OTHER_TAB_ACTIVE', 'Another chain action is active.'); await work(); }); }
    catch (e) { setError(formatDiagnostic(e)); }
    finally { setBusy(false); allDrafts().then(setDrafts).catch(e => setError(formatDiagnostic(e))); }
  }
  async function loadOwner() {
    invariant(signer, 'WALLET_REQUIRED', 'Connect JoyID on Pudge.');
    const typeId = JUKEBOX_CONFIG.registryTypeId ?? (await registryRecords()).find(r => r.id === 'registry-create')?.typeId;
    invariant(typeId, 'MISSING_REGISTRY', 'Finish registry creation and verification first.');
    const state = await findRegistry(typeId, createPudgeClient()); await assertRegistryOwner(signer, state); setRegistry(state); setStatus(`Owner verified. Current registry revision ${state.data.revision}.`);
  }
  async function selectFile(chosen: File) {
    const bytes = new Uint8Array(await chosen.arrayBuffer()); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    setFile({ filename: chosen.name, bytes }); setReport(inspectHTML(text)); setTitle(chosen.name.replace(/\.html?$/i, '')); setDynamicReviewed(false); setPreviewSeen(false); setSelected(''); setPending(undefined);
  }
  async function saveNewDraft() {
    invariant(file && registry && signer, 'OWNER_REQUIRED', 'Select a file and load the owner registry first.'); await assertRegistryOwner(signer, registry);
    invariant(report?.acceptable && (!report.issues.some(i => i.kind === 'dynamic') || dynamicReviewed), 'INSPECTION_REQUIRED', 'Resolve portability errors and review any dynamic references first.');
    const draft = await createDraft(file.filename, file.bytes, { id: crypto.randomUUID(), title: title.trim(), description, category: category.trim(), tags: tags.split(',').map(t => t.trim()).filter(Boolean), capabilities: caps }, registry);
    const inspected = await inspectDraft(draft); setSelected(inspected.draft.draftId); setPreviewSeen(false); setStatus('Draft saved and inspected. Open its production-sandbox preview, then confirm that it works.');
  }
  const previewBytes = current ? ckb.bytesFrom(current.local.content) : file?.bytes;
  const previewCaps = current?.local.metadata.capabilities ?? caps;
  return <section className="panel full" aria-label="Publish a demo"><p className="eyebrow">SERVICE PANEL / IMMUTABLE DEMO PUBLISH</p><h2>Put a new demo on the jukebox.</h2>
    <p>Inspect → sandbox preview → hash → publish demo → independently verify → publish manifest → independently verify → update registry → re-query.</p>
    <div role="status" className="status">{status}</div>{error && <div role="alert" className="error">{error}</div>}
    <button disabled={busy || !signer} onClick={() => action(loadOwner)}>Load & authorize owner registry</button>
    <div className="registry-steps"><div><label>Single-file HTML<input type="file" accept=".html,.htm,text/html" disabled={busy} onChange={e => { const selected = e.target.files?.[0]; if (selected) action(() => selectFile(selected)); }}/></label>
      <label>Demo title<input value={title} onChange={e => setTitle(e.target.value)} disabled={!!current}/></label><label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!!current}/></label><label>Category<input value={category} onChange={e => setCategory(e.target.value)} disabled={!!current}/></label><label>Tags, comma separated<input value={tags} onChange={e => setTags(e.target.value)} disabled={!!current}/></label></div>
      <div><h3>Approved capabilities</h3>{(Object.keys(caps) as (keyof DemoCapabilities)[]).map(key => <label className="check" key={key}><input type="checkbox" checked={caps[key]} disabled={!!current} onChange={e => { setCaps({ ...caps, [key]: e.target.checked }); setPreviewSeen(false); }}/>{key === 'audio' ? 'Audio / autoplay' : key}</label>)}
        <p>Fullscreen keeps the host toolbar visible. Geolocation and clipboard may remain unavailable in opaque-origin frames. The scanner checks portability, not malware.</p>
        {report && <div><strong>{report.acceptable ? 'No unresolved relative dependencies detected.' : 'Portability errors must be fixed before publishing.'}</strong><ul>{report.issues.map((issue, i) => <li key={i}>{issue.kind}: {issue.source} — <code>{issue.value}</code></li>)}</ul>{report.externalUrls.length > 0 && <p>{report.externalUrls.length} external HTTPS resources detected. Enable network access to load them.</p>}{report.issues.some(i => i.kind === 'dynamic') && <label className="check"><input type="checkbox" checked={dynamicReviewed} onChange={e => setDynamicReviewed(e.target.checked)}/>I reviewed the dynamic resource references.</label>}</div>}
      </div></div>
    <div className="actions"><button disabled={busy || !previewBytes} onClick={() => { setPreview(true); setPreviewSeen(false); }}>Open production-sandbox preview</button><button disabled={busy || !registry || !file || !title.trim() || !category.trim() || !!current || !report?.acceptable} onClick={() => action(saveNewDraft)}>Save inspected publish draft</button></div>
    {preview && previewBytes && <Player bytes={previewBytes} title={current?.local.metadata.title ?? (title || 'Local preview')} capabilities={previewCaps} preview onClose={() => { setPreview(false); setPreviewSeen(true); }}/>}
    <label>Resume saved draft<select value={selected} onChange={e => { setSelected(e.target.value); setPending(undefined); setPreviewSeen(false); }}><option value="">New draft</option>{drafts.map(d => <option value={d.draftId} key={d.draftId}>{d.local.metadata.title} · {d.stage}</option>)}</select></label>
    {current && <div className="estimate"><h3>{current.local.metadata.title} · {current.stage}</h3><p>{current.local.bytes.toLocaleString()} bytes · <code>{current.local.contentHash}</code></p>{current.local.bytes > SEGMENT_BYTES && <p>Large-file upload: about {Math.ceil(current.local.bytes / SEGMENT_BYTES)} segments (final count depends on serialized transaction size). {current.demoSegments?.filter(s => s.verified).length ?? 0} verified; {(current.demoSegments?.filter(s => s.verified).at(-1)?.end ?? 0).toLocaleString()} / {current.local.bytes.toLocaleString()} bytes. Signed segments are saved and reused after reload. The first segment creates the file cell; appends reuse it and pay their transaction fees.</p>}{current.error && <p className="error">{current.error}</p>}
      {!current.previewed && <button disabled={busy || !current.inspected || !previewSeen} onClick={() => action(async () => { await confirmPreview(current); setStatus('Preview approved. Continue to prepare the demo publish transaction.'); })}>Preview works — approve these exact bytes</button>}
      {current.previewed && current.stage !== 'COMPLETE' && <div className="actions"><button disabled={busy || !signer || !!pending} onClick={() => action(async () => { invariant(signer, 'WALLET_REQUIRED', 'Connect JoyID.'); const result = await advanceDraft(current.draftId, signer); setPending(result.action ? { action: result.action, signer } : undefined); setStatus(result.action ? `Review the ${result.action.kind} transaction before signing.` : `Stage verified: ${result.draft.stage}. Continue to the next safe step.`); })}>Continue next safe step</button><button disabled={busy || !signer || !(current.demo || current.demoSegments?.length)} onClick={() => action(async () => { invariant(signer, 'WALLET_REQUIRED', 'Connect JoyID.'); await recoverDraftTransaction(current.draftId, signer); setPending(undefined); setStatus('Known transaction re-queried. Continue after it commits.'); })}>Recover known transaction</button></div>}
      {[...(current.demoSegments ?? (current.demo ? [current.demo] : [])), current.manifest?.receipt, current.registry].filter(Boolean).map(receipt => <p key={receipt!.txHash}><a href={`https://pudge.explorer.nervos.org/transaction/${receipt!.txHash}`} target="_blank" rel="noreferrer">{receipt!.txHash} ↗</a></p>)}
      {pending && <div><h3>{pending.action.kind === 'demo-segment' ? `Demo segment ${pending.action.segmentIndex + 1} (${pending.action.start === 0 ? 'publish' : 'append'})` : pending.action.kind} · TESTNET/PUDGE</h3>{pending.action.kind === 'demo-segment' && <p>Bytes {(pending.action.start + 1).toLocaleString()}–{pending.action.end.toLocaleString()} of {current.local.bytes.toLocaleString()}. Each append preserves the same Type ID. Wait for confirmation and continue to verify this segment before the next signature.</p>}<p>Locked capacity {ckb.fixedPointToString(BigInt(pending.action.prepared.estimate.capacity))} CKB · fee {ckb.fixedPointToString(BigInt(pending.action.prepared.estimate.fee))} CKB · {pending.action.prepared.estimate.transactionBytes} serialized bytes</p><button disabled={busy || signer !== pending.signer} onClick={() => action(async () => { invariant(signer === pending.signer, 'WALLET_CHANGED', 'Reconnect the same wallet.'); await signDraftAction(pending.action, signer); setPending(undefined); setStatus('Transaction broadcast and persisted. Continue to independently verify after commitment.'); })}>Sign {pending.action.kind === 'demo-segment' ? (pending.action.start ? 'append' : 'first segment') : pending.action.kind} transaction on Pudge</button></div>}
    </div>}
  </section>;
}
