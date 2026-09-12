import { useEffect, useRef, useState } from 'react';
import * as ckb from '@ckb-ccc/core';
import { ccc } from '@ckb-ccc/connector-react';
import { JUKEBOX_CONFIG } from '../../config/jukebox';
import { createPudgeClient } from '../ckbfs/client';
import { invariant, formatDiagnostic } from '../ckbfs/errors';
import { prepareV3, broadcastPreparedV3, type PreparedV3 } from '../ckbfs/publisher';
import { initialManifest, manifestBytes, nextManifest, type Manifest, type ManifestPointer, type VerifiedManifest } from './manifest';
import { assertRegistryOwner, broadcastRegistry, prepareRegistryCreation, prepareRegistryUpdate, prepareRegistryRollback, registryCatalog, type PreparedRegistry, type RegistryState } from './registry';
import { registryRecords, saveRegistryRecord, verifyRegistryRecord, recoverRegistryRecord, type RegistryRecord } from './journal';
const ckbAmount = (value: string) => ckb.fixedPointToString(BigInt(value));
type Review = { kind: 'manifest'; id: string; prepared: PreparedV3; content: Uint8Array; signer: ckb.Signer; owner: string } | { kind: 'registry'; id: string; prepared: PreparedRegistry; signer: ckb.Signer };
export function RegistryPanel() {
  const signer = ccc.useSigner(); const [journal, setJournal] = useState<RegistryRecord[]>([]);
  const [initial] = useState(() => initialManifest()); const [review, setReview] = useState<Review>();
  const [catalog, setCatalog] = useState<{ registry: RegistryState; manifest: VerifiedManifest }>();
  const [owner, setOwner] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('Storage proof complete. The first manifest and registry are ready to prepare.'), [error, setError] = useState('');
  const [collectionName, setCollectionName] = useState('AI HTML Jukebox');
  const active = useRef(false);
  const registryTypeId = JUKEBOX_CONFIG.registryTypeId ?? journal.find(r => r.id === 'registry-create')?.typeId;
  const joyId = signer?.signType === ckb.SignerSignType.JoyId;
  useEffect(() => { registryRecords().then(setJournal).catch(e => setError(formatDiagnostic(e))); }, []);
  useEffect(() => { setReview(undefined); setOwner(false); let cancelled = false; if (signer && catalog) assertRegistryOwner(signer, catalog.registry).then(() => { if (!cancelled) setOwner(true); }).catch(() => {}); return () => { cancelled = true; }; }, [signer, catalog]);
  async function loadCatalog() {
    invariant(registryTypeId, 'MISSING_REGISTRY', 'Publish and verify the initial manifest, then create the registry.');
    const result = await registryCatalog(registryTypeId, createPudgeClient()); setCatalog(result); setCollectionName(result.manifest.manifest.collection.name);
    setStatus(`Registry revision ${result.registry.data.revision} and manifest ${result.manifest.manifest.revision} independently verified.`);
  }
  async function action(work: () => Promise<void>) {
    if (active.current) return; active.current = true; setBusy(true); setError('');
    try {
      invariant(window.isSecureContext && navigator.locks, 'UNSUPPORTED_CONTEXT', 'Use a secure normal browser with IndexedDB, Web Locks and JoyID support.');
      await navigator.locks.request('ckbfs-phase-1-proof', { ifAvailable: true }, async lock => { invariant(lock, 'OTHER_TAB_ACTIVE', 'Another chain action is active in this browser.'); await work(); });
    } catch (e) { setError(formatDiagnostic(e)); }
    finally { active.current = false; setBusy(false); registryRecords().then(setJournal).catch(e => setError(formatDiagnostic(e))); }
  }
  async function assertNew(id: string) { invariant(!(await registryRecords()).some(r => r.id === id), 'DUPLICATE_UPLOAD_BLOCKED', 'A signed operation already exists. Verify or recover it below.'); }
  async function prepareManifest(manifest: Manifest, id: string) {
    invariant(signer && joyId, 'WALLET_REQUIRED', 'Connect JoyID on Pudge.'); await assertNew(id);
    const lock = await assertRegistryOwner(signer, catalog?.registry); const content = manifestBytes(manifest);
    const prepared = await prepareV3({ content, contentType: 'application/json; charset=utf-8', filename: `jukebox-manifest-${manifest.revision}.json`, signer });
    setReview({ kind: 'manifest', id, prepared, content, signer, owner: lock.hash() }); setStatus('Review the exact JSON and transaction cost, then sign to publish the immutable manifest.');
  }
  async function prepareRegistry(id: string, pointer: ManifestPointer, operation: 'create' | 'update' | 'rollback') {
    invariant(signer && joyId, 'WALLET_REQUIRED', 'Connect JoyID on Pudge.'); await assertNew(id);
    let prepared: PreparedRegistry;
    if (operation === 'create') { invariant(!JUKEBOX_CONFIG.registryTypeId && !registryTypeId, 'REGISTRY_EXISTS', 'A registry already exists; reload it instead of creating another singleton.'); prepared = await prepareRegistryCreation(signer, pointer); }
    else { invariant(catalog, 'MISSING_REGISTRY', 'Load the current registry first.'); prepared = operation === 'update' ? await prepareRegistryUpdate(signer, catalog.registry, pointer) : await prepareRegistryRollback(signer, catalog.registry, pointer); }
    setReview({ kind: 'registry', id, prepared, signer }); setStatus('Manifest verified. Review the registry transition before signing.');
  }
  async function sign() {
    invariant(review && signer === review.signer, 'WALLET_CHANGED', 'Wallet changed. Prepare the transaction again.'); await assertNew(review.id);
    const current = review;
    if (current.kind === 'manifest') {
      invariant((await assertRegistryOwner(signer, catalog?.registry)).hash() === current.owner, 'OWNER_LOCK_MISMATCH', 'Connected lock changed after preparation.');
      await broadcastPreparedV3(current.prepared, { signer, persistSigned: async signed => saveRegistryRecord({ id: current.id, kind: 'manifest', typeId: signed.typeId, txHash: signed.txHash, transaction: signed.transaction,
        content: ckb.hexFrom(current.content), contentHash: ckb.hashCkb(current.content), status: 'signed', updatedAt: new Date().toISOString() }) });
    } else await broadcastRegistry(current.prepared, signer, async signed => saveRegistryRecord({ id: current.id, kind: 'registry', typeId: signed.typeId, txHash: signed.txHash, transaction: signed.transaction,
      registryData: signed.data, previousOutPoint: signed.previousOutPoint, status: 'signed', updatedAt: new Date().toISOString() }));
    const saved = (await registryRecords()).find(r => r.id === current.id)!; await saveRegistryRecord({ ...saved, status: 'broadcast', updatedAt: new Date().toISOString() });
    setReview(undefined); setStatus('Broadcast saved. Wait for commitment, then independently verify below.');
  }
  const initialRecord = journal.find(r => r.id === 'manifest-1');
  const nextRevision = catalog ? (catalog.registry.data.revision + 1n).toString() : '';
  const nextRecord = journal.find(r => r.id === `manifest-${nextRevision}`);
  const pendingReview = review && !journal.some(r => r.id === review.id);
  return <section className="registry-panel panel full" aria-label="Registry and manifest setup">
    <p className="eyebrow">PHASE 2 / OWNER-CONTROLLED CATALOG</p><h2>Give the jukebox a permanent address.</h2>
    <p>First publish an empty catalog manifest. After independent verification, create its singleton registry using your JoyID lock and CKB’s built-in Type ID. These are two separate transactions.</p>
    <div role="status" aria-live="polite" className="status">{status}</div>{error && <div role="alert" className="error">{error}</div>}
    <div className="registry-steps"><div><h3>1. Publish the initial manifest</h3><p>Schema 1 · revision 1 · zero demos. Proof fixtures stay outside the public catalog.</p>
      <button disabled={busy || !joyId || !!initialRecord || !!registryTypeId} onClick={() => action(() => prepareManifest(initial, 'manifest-1'))}>Prepare initial manifest</button></div>
      <div><h3>2. Create the singleton registry</h3><p>The output stores the verified manifest Type ID and Blake2b hash. Its owner is the connected JoyID recommended lock.</p>
      <button disabled={busy || !joyId || initialRecord?.status !== 'verified' || !!registryTypeId} onClick={() => action(() => prepareRegistry('registry-create', { typeId: initialRecord!.typeId, contentHash: initialRecord!.contentHash! }, 'create'))}>Prepare registry creation</button></div></div>
    {!joyId && <p className="muted">Connect a funded Pudge JoyID wallet using the button above.</p>}
    {pendingReview && <div className="estimate"><h3>{review.kind === 'manifest' ? 'Publish manifest' : `${review.prepared.estimate.operation} registry`} · TESTNET/PUDGE</h3>
      <dl><div><dt>Locked capacity</dt><dd>{ckbAmount(review.prepared.estimate.capacity)} CKB</dd></div><div><dt>Fee</dt><dd>{ckbAmount(review.prepared.estimate.fee)} CKB</dd></div><div><dt>Serialized bytes</dt><dd>{review.prepared.estimate.transactionBytes}</dd></div></dl>
      {review.kind === 'manifest' ? <><p>{review.prepared.estimate.bytes} content bytes · {review.prepared.estimate.chunkCount} witness chunks</p><pre className="json-preview">{JSON.stringify(JSON.parse(new TextDecoder().decode(review.content)), null, 2)}</pre></> : <><p>Registry revision {review.prepared.estimate.revision}. {review.prepared.previous ? 'Consumes one registry cell and recreates exactly the same Type ID and owner lock.' : 'Creates a new built-in Type ID singleton controlled by your JoyID lock.'}</p><p>Manifest Type ID: <code>{review.prepared.data.manifestTypeId}</code><br/>Manifest hash: <code>{review.prepared.data.manifestHash}</code><br/>Registry Type ID: <code>{review.prepared.typeId}</code></p></>}
      <button className="primary" disabled={busy} onClick={() => action(sign)}>{review.kind === 'manifest' ? 'Sign & publish manifest on Pudge' : 'Sign registry transaction on Pudge'}</button></div>}
    <ol className="proofs">{journal.map(record => <li key={record.id}><div><strong>{record.id}</strong><span className={record.status === 'verified' ? 'pass' : 'muted'}>{record.status}</span><a href={`https://pudge.explorer.nervos.org/transaction/${record.txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a><code>{record.txHash}</code></div>
      {record.status !== 'verified' && <div className="actions"><button disabled={busy} onClick={() => action(async () => { await verifyRegistryRecord(record, createPudgeClient()); setStatus(`${record.id}: committed state and exact manifest hash independently verified.`); })}>Verify {record.kind}</button><button disabled={busy} onClick={() => action(async () => { setStatus(`Recovery: ${await recoverRegistryRecord(record, createPudgeClient())}.`); })}>Recover {record.id}</button></div>}</li>)}</ol>
    {registryTypeId && <div><p>Registry Type ID: <code>{registryTypeId}</code></p><button disabled={busy} onClick={() => action(loadCatalog)}>Load registry & verified catalog</button></div>}
    {catalog && <div className="estimate"><h3>Registry revision {catalog.registry.data.revision.toString()} · manifest {catalog.manifest.manifest.revision}</h3><p>{catalog.manifest.manifest.items.length} catalog items. {owner ? 'Connected JoyID matches the owner lock.' : 'Read-only: connected JoyID does not match the owner lock.'}</p>
      <label>Collection name for next manifest<input value={collectionName} onChange={e => setCollectionName(e.target.value)} disabled={!owner || busy}/></label>
      <div className="actions"><button disabled={busy || !owner || !!nextRecord || !collectionName.trim()} onClick={() => action(async () => { const manifest = nextManifest(catalog.manifest, catalog.registry.data.revision, catalog.manifest.manifest.items); manifest.collection.name = collectionName.trim(); await prepareManifest(manifest, `manifest-${nextRevision}`); })}>Prepare manifest revision {nextRevision}</button>
      <button disabled={busy || !owner || nextRecord?.status !== 'verified'} onClick={() => action(() => prepareRegistry(`registry-${nextRevision}`, { typeId: nextRecord!.typeId, contentHash: nextRecord!.contentHash! }, 'update'))}>Prepare registry revision {nextRevision}</button>
      <button disabled={busy || !owner || !catalog.manifest.manifest.previous} onClick={() => action(() => prepareRegistry(`rollback-${nextRevision}`, catalog.manifest.manifest.previous!, 'rollback'))}>Prepare rollback to previous manifest</button></div><p>Rollback verifies the historical manifest and increments the registry revision; it never decrements it.</p></div>}
  </section>;
}
