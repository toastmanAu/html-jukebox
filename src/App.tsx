import { useEffect, useRef, useState } from 'react';
import * as ckb from '@ckb-ccc/core';
import { ccc } from '@ckb-ccc/connector-react';
import { broadcastPreparedV3, createPudgeClient, prepareV3, resolveV3, verifyV3Deployment, type DeploymentVerification, type PreparedV3 } from './ckbfs';
import { assertPudge, findLiveV3 } from './ckbfs/client';
import { concat } from './ckbfs/codec';
import { invariant, formatDiagnostic } from './ckbfs/errors';
import { proofKinds, records, rebroadcastRecord, saveRecord, verifyRecord, type ProofKind, type ProofRecord } from './proof/journal';
import { proofBytes, proofLabels } from './proof/fixtures';
import './style.css';
import { AdminPanel } from './admin/AdminPanel';
import { RegistryPanel } from './registry/RegistryPanel';
const explorer = 'https://pudge.explorer.nervos.org/transaction/';
const money = (value: string) => ckb.fixedPointToString(BigInt(value));
export default function App() {
  const wallet = ccc.useCcc(); const signer = ccc.useSigner();
  const [deployment, setDeployment] = useState<DeploymentVerification>();
  const [journal, setJournal] = useState<ProofRecord[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('Run the deployment check to begin.');
  const [selected, setSelected] = useState<ProofKind>('small');
  const [prepared, setPrepared] = useState<{ prepared: PreparedV3; kind: ProofKind; expected: Uint8Array; signer: ckb.Signer; ownerLockHash: string }>();
  const [identifier, setIdentifier] = useState(''), [expectedHash, setExpectedHash] = useState('');
  const [resolved, setResolved] = useState<{ filename: string; bytes: number; checksum: number; hash: string; segments: number; chunks: number }>();
  const actionLock = useRef(false);
  const joyId = signer?.signType === ckb.SignerSignType.JoyId;
  const contextSupported = typeof window !== 'undefined' && window.isSecureContext && !!navigator.locks;
  useEffect(() => { records().then(setJournal).catch(e => setError(`STORAGE_UNAVAILABLE: ${String(e)}`)); }, []);
  useEffect(() => { setPrepared(undefined); }, [signer]);
  async function action(task: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      invariant(contextSupported, 'UNSUPPORTED_CONTEXT', 'Use a current secure browser with IndexedDB and Web Locks, such as Chrome at localhost or HTTPS.');
      await navigator.locks.request('ckbfs-phase-1-proof', { ifAvailable: true }, async lock => {
        invariant(lock, 'OTHER_TAB_ACTIVE', 'A proof action is active in another tab. Wait for it to finish.'); await task();
      });
    } catch (e) { setError(formatDiagnostic(e)); }
    finally { setBusy(false); actionLock.current = false; records().then(setJournal).catch(e => setError(String(e))); }
  }
  async function checkDeployment() {
    setDeployment(undefined); setPrepared(undefined);
    setStatus('Checking Pudge genesis, dep group and code bytes…');
    const result = await verifyV3Deployment(createPudgeClient()); setDeployment(result); setStatus('Pinned V3 deployment verified against live Pudge.');
  }
  async function prepare() {
    invariant(signer && joyId, 'WALLET_REQUIRED', 'Connect a funded Pudge JoyID wallet to prepare a proof transaction.');
    await assertPudge(signer.client);
    const current = await records();
    invariant(!current.some(r => r.id === selected), 'DUPLICATE_UPLOAD_BLOCKED', 'A signed proof already exists. Use Verify or Recover below.');
    const content = proofBytes(selected);
    let expected = content; let prior: ckb.Cell | undefined;
    if (selected.startsWith('append')) {
      const parent = current.find(r => r.id === (selected === 'append-1' ? 'multi' : 'append-1'));
      invariant(parent?.status === 'verified', 'PREVIOUS_PROOF_REQUIRED', 'Verify the preceding multi-witness publish or append before this append.');
      const previous = await resolveV3(parent.typeId, { client: createPudgeClient() });
      invariant(ckb.hashCkb(previous.fileBytes) === parent.expectedHash && previous.currentOutPoint.txHash === parent.txHash,
        'CELL_CHANGED', 'The previous proof changed on chain. Inspect it before continuing.');
      prior = await findLiveV3(signer.client, parent.typeId);
      invariant(prior.outPoint.txHash === parent.txHash, 'CELL_CHANGED', 'The append input changed during preparation.');
      expected = concat([previous.fileBytes, content]);
    }
    setStatus('Collecting inputs and calculating the final witness-bearing transaction…');
    const ownerLockHash = (await signer.getRecommendedAddressObj()).script.hash();
    const result = await prepareV3({ signer, content, filename: `jukebox-proof-${selected}.html`, contentType: 'text/html; charset=utf-8' }, prior);
    setPrepared({ prepared: result, kind: selected, expected, signer, ownerLockHash });
    setStatus('Estimate ready. Review capacity and fee before signing.');
  }
  async function sign() {
    invariant(prepared && signer === prepared.signer && joyId, 'WALLET_CHANGED', 'Reconnect the same JoyID wallet and prepare again.');
    invariant((await signer.getRecommendedAddressObj()).script.hash() === prepared.ownerLockHash, 'OWNER_LOCK_MISMATCH', 'Connected lock changed since preparation.');
    invariant(!(await records()).some(r => r.id === prepared.kind), 'DUPLICATE_UPLOAD_BLOCKED', 'Recover the existing proof transaction.');
    const item = prepared;
    const result = await broadcastPreparedV3(item.prepared, { signer, persistSigned: async signed => {
      await saveRecord({ id: item.kind, typeId: signed.typeId, txHash: signed.txHash, signedTransaction: signed.transaction,
        expectedBytes: ckb.hexFrom(item.expected), expectedHash: ckb.hashCkb(item.expected), ownerLockHash: item.ownerLockHash,
        status: 'signed', updatedAt: new Date().toISOString() });
    } });
    const record = (await records()).find(r => r.txHash === result.txHash)!;
    await saveRecord({ ...record, status: 'broadcast', updatedAt: new Date().toISOString() });
    setPrepared(undefined); setStatus('Broadcast recorded. Wait for confirmation, then independently verify the bytes.');
  }
  async function resolve() {
    setStatus('Resolving from live Pudge and validating every segment…'); setResolved(undefined);
    const result = await resolveV3(identifier, { client: createPudgeClient() }); const hash = ckb.hashCkb(result.fileBytes);
    if (expectedHash.trim()) invariant(/^0x[\da-f]{64}$/i.test(expectedHash.trim()) && hash === expectedHash.trim().toLowerCase(), 'HASH_MISMATCH', 'Resolved content does not match the supplied cryptographic hash.');
    setResolved({ filename: result.filename, bytes: result.size, checksum: result.checksum, hash, segments: result.history.length, chunks: result.history.reduce((sum, s) => sum + s.chunkCount, 0) });
    setStatus(expectedHash.trim() ? 'Checksum and supplied content hash verified.' : 'CKBFS checksum verified. Content hash computed; no expected hash was supplied.');
  }
  function exportEvidence() {
    const bytes = JSON.stringify({ deployment, proofs: journal.map(({ signedTransaction: _signed, expectedBytes: _bytes, ...record }) => record) }, null, 2);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'pudge-browser-proof.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main>
    <header><a className="brand" href="/">CKBFS <span>JUKEBOX</span></a><span className="network">● TESTNET / PUDGE</span><button onClick={() => wallet.open()} disabled={busy}>{signer ? 'JoyID connection' : 'Connect JoyID'}</button></header>
    <section className="intro"><p className="eyebrow">AI HTML JUKEBOX · ENGINEERING PREVIEW</p><h1>Storage proven.<br/><em>Build the catalog.</em></h1><p className="lede">Five browser-signed Pudge proofs passed. The catalog is live. Publish demos below; the Phase 2 tools are retained for registry diagnostics and history.</p></section>
    <div className="gate"><strong>Phase 1 complete</strong><span>Single-witness, multi-witness, two appends and empty-file round trips verified on Pudge. Registry creation, update, rollback and the first complete demo publication are verified.</span></div>
    <AdminPanel/>
    <RegistryPanel/>
    <h2>Storage diagnostics & completed proof sequence</h2>
    <div role="status" aria-live="polite" className="status">{busy ? '◌ ' : '● '}{status}</div>
    {error && <div role="alert" className="error">{error}</div>}
    {!contextSupported && <p role="alert">Unsupported browser context. Open this app at localhost or HTTPS in a browser with Web Locks and IndexedDB.</p>}
    <div className="workbench">
      <section className="panel"><p className="eyebrow">A / CONTRACT IDENTITY</p><h2>Locked means locked.</h2><p>Protocol <code>20250821.4ee6689bf7ec</code>. Live code bytes, Type IDs and dep-group outpoints are checked together.</p>
        <button disabled={busy} onClick={() => action(checkDeployment)}>{deployment ? 'Recheck deployment' : 'Verify Pudge deployment'}</button>
        {deployment && <p className="pass">✓ V3 + Adler32 verified <small>{new Date(deployment.checkedAt).toLocaleString()}</small></p>}
      </section>
      <section className="panel"><p className="eyebrow">B / READ WITHOUT A WALLET</p><h2>Trace every witness.</h2>
        <label>CKBFS Type ID or explicit outpoint<input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="0x… or txHash:0" spellCheck={false}/></label>
        <label>Expected CKB Blake2b hash <span>(optional)</span><input value={expectedHash} onChange={e => setExpectedHash(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
        <button disabled={busy || !identifier.trim()} onClick={() => action(resolve)}>Resolve & verify</button>
        {resolved && <div className="result"><strong>{resolved.filename}</strong><p>{resolved.bytes.toLocaleString()} bytes · {resolved.chunks} witnesses · {resolved.segments} transactions</p><code>{resolved.hash}</code><p>HTML is not executed by this diagnostic.</p></div>}
      </section>
      <section className="panel full"><p className="eyebrow">C / BROWSER PUBLISH PROOF</p><h2>A complete round trip.</h2><p>Use dedicated testnet funds. Each publish creates a permanent V3 file cell; append transactions preserve its Type ID. Wallet signatures are required.</p>
        <div className="controls"><label>Proof transaction<select value={selected} disabled={busy} onChange={e => { setSelected(e.target.value as ProofKind); setPrepared(undefined); }}>{proofKinds.map(kind => <option key={kind} value={kind}>{proofLabels[kind]}</option>)}</select></label>
        <button disabled={busy || !joyId || !deployment || journal.some(r => r.id === selected)} onClick={() => action(prepare)}>Prepare & estimate</button></div>
        {!joyId && <p className="muted">Connect JoyID on Pudge to enable transaction preparation.</p>}
        {prepared && <div className="estimate"><h3>{proofLabels[prepared.kind]} · TESTNET/PUDGE</h3><dl><div><dt>Content</dt><dd>{prepared.prepared.estimate.bytes.toLocaleString()} bytes / {prepared.prepared.estimate.chunkCount} chunks</dd></div><div><dt>Locked capacity</dt><dd>{money(prepared.prepared.estimate.capacity)} CKB</dd></div><div><dt>Fee</dt><dd>{money(prepared.prepared.estimate.fee)} CKB</dd></div><div><dt>Serialized transaction</dt><dd>{prepared.prepared.estimate.transactionBytes.toLocaleString()} / 100,000 bytes</dd></div></dl><p>{prepared.kind.startsWith('append') ? 'Consumes and recreates the existing CKBFS file cell, preserving its Type ID and adding a segment.' : 'Creates a new CKBFS V3 file cell containing the proof fixture metadata.'}</p><button className="primary" disabled={busy} onClick={() => action(sign)}>Sign & broadcast on Pudge</button></div>}
        <ol className="proofs">{proofKinds.map(kind => { const record = journal.find(r => r.id === kind); return <li key={kind}><div><strong>{proofLabels[kind]}</strong><span className={record?.status === 'verified' ? 'pass' : 'muted'}>{record?.status ?? 'Not started'}</span>{record && <a href={explorer + record.txHash} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>{record && record.status !== 'verified' && <div className="actions"><button disabled={busy} onClick={() => action(async () => { await verifyRecord(record); setStatus(`${proofLabels[kind]}: exact bytes, Adler32 and Blake2b verified from a fresh RPC client.`); })}>Verify committed bytes</button><button disabled={busy} onClick={() => action(async () => { const client = createPudgeClient(); await assertPudge(client); const result = await rebroadcastRecord(record, client); setStatus(`Recovery: transaction is ${result}. Verify after confirmation.`); })}>Recover same transaction</button></div>}</li>; })}</ol>
        <button disabled={busy || !journal.length} onClick={exportEvidence}>Export proof evidence</button>
      </section>
    </div><footer><span>CKBFS AI HTML JUKEBOX</span><span>V3 storage verified · Owner-controlled registry configured</span></footer>
  </main>;
}
