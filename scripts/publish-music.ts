/**
 * Publish audio files to CKBFS V3 on Pudge with a throwaway private key.
 *
 *   npx tsx scripts/publish-music.ts new-key            create the key file, print its address
 *   npx tsx scripts/publish-music.ts address            print the address and balance
 *   npx tsx scripts/publish-music.ts plan  <manifest>   show transactions and cost, sign nothing
 *   npx tsx scripts/publish-music.ts run   <manifest>   publish, resumable
 *
 * <manifest> is a JSON file: [{ "slug": "...", "file": "01.webm", "contentType": "audio/webm" }],
 * files relative to it. Progress is journalled beside it (publish-journal.json) BEFORE every
 * broadcast, so an interrupted run resumes without re-sending or duplicating a segment. When
 * every file is verified the CKBFS pointers are written to onchain.json.
 *
 * A file larger than one transaction is published as a first segment plus appends. Tracks
 * advance in rounds - one segment each, then wait for the round to commit - because an append
 * needs the previous segment's cell to be live.
 *
 * The key file must be private (mode 600) and is never printed. This is for testnet funds only;
 * the publisher refuses any chain that is not Pudge.
 */
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import * as ccc from '@ckb-ccc/core';
import { appendV3, publishV3, resolveV3, createPudgeClient } from '../src/ckbfs';
import { assertPudge } from '../src/ckbfs/client';

const KEY_FILE = process.env.PUDGE_DEPLOY_KEY_FILE ?? join(homedir(), '.config/html-jukebox/pudge-deploy.key');
/** Content bytes per transaction: 16 kB witnesses plus headers stay under the 100 kB limit. */
const SEGMENT_BYTES = 88_000;
const POLL_MS = 6_000, COMMIT_TIMEOUT_MS = 15 * 60_000;

interface Segment { offset: number; length: number; txHash: string; signed: string; status: 'signed' | 'broadcast' | 'committed' }
interface Entry { slug: string; file: string; contentType: string; bytes: number; contentHash: string; typeId?: string; segments: Segment[]; verified?: boolean }
type Journal = Record<string, Entry>;

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const ckb = (shannons: bigint) => ccc.fixedPointToString(shannons);

async function loadSigner() {
  const info = await stat(KEY_FILE).catch(() => undefined);
  if (!info) throw new Error(`No key at ${KEY_FILE}. Run: npx tsx scripts/publish-music.ts new-key`);
  if (info.mode & 0o077) throw new Error(`${KEY_FILE} is readable by other users. Run: chmod 600 ${KEY_FILE}`);
  const key = (await readFile(KEY_FILE, 'utf8')).trim();
  if (!/^0x[\da-f]{64}$/.test(key)) throw new Error(`${KEY_FILE} does not hold a 32-byte hex key.`);
  const client = createPudgeClient();
  await assertPudge(client);
  return new ccc.SignerCkbPrivateKey(client, key);
}

async function newKey() {
  if (await stat(KEY_FILE).catch(() => undefined)) throw new Error(`${KEY_FILE} already exists; refusing to overwrite a key that may hold funds.`);
  await mkdir(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  await writeFile(KEY_FILE, `0x${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(KEY_FILE, 0o600);
  console.log(`Key written to ${KEY_FILE} (mode 600). It is not shown here.`);
  await showAddress();
}

async function showAddress() {
  const signer = await loadSigner();
  console.log(`Pudge address: ${await signer.getRecommendedAddress()}`);
  console.log(`Balance:       ${ckb(await signer.getBalance())} CKB`);
}

async function readManifest(path: string): Promise<{ dir: string; entries: Entry[] }> {
  const dir = dirname(resolve(path));
  const items = JSON.parse(await readFile(path, 'utf8')) as { slug: string; file: string; contentType: string }[];
  const entries: Entry[] = [];
  for (const item of items) {
    if (!/^audio\/[\w.+-]+$/.test(item.contentType)) throw new Error(`${item.slug}: contentType must be an audio type.`);
    const bytes = await readFile(join(dir, item.file));
    entries.push({ ...item, bytes: bytes.length, contentHash: ccc.hashCkb(bytes), segments: [] });
  }
  return { dir, entries };
}

function segmentsFor(bytes: number) { return Math.max(1, Math.ceil(bytes / SEGMENT_BYTES)); }

async function plan(path: string) {
  const { entries } = await readManifest(path);
  const total = entries.reduce((sum, e) => sum + e.bytes, 0), txs = entries.reduce((sum, e) => sum + segmentsFor(e.bytes), 0);
  for (const e of entries) console.log(`${e.slug.padEnd(44)} ${(e.bytes / 1024).toFixed(0).padStart(5)} kB  ${segmentsFor(e.bytes)} tx`);
  // Each file cell locks its own capacity (about 8 + lock + type + metadata bytes); fees are 2000 shannons/kB.
  const locked = BigInt(entries.length) * 220n * 100_000_000n, fees = BigInt(Math.ceil(total * 1.05)) * 2n;
  console.log(`\n${entries.length} files, ${(total / 1e6).toFixed(1)} MB, ${txs} transactions, ${Math.max(...entries.map(e => segmentsFor(e.bytes)))} rounds`);
  console.log(`Roughly ${ckb(locked)} CKB locked in file cells and ${ckb(fees)} CKB in fees; keep 100 CKB spare for change.`);
}

async function txStatus(client: ccc.Client, hash: string): Promise<string> {
  const response = await client.getTransactionNoCache(hash as ccc.Hex).catch(() => undefined);
  return response?.status ?? 'unknown';
}

async function run(path: string) {
  const { dir, entries } = await readManifest(path);
  const journalPath = join(dir, 'publish-journal.json');
  const journal: Journal = JSON.parse(await readFile(journalPath, 'utf8').catch(() => '{}'));
  const save = () => writeFile(journalPath, JSON.stringify(journal, null, 1));
  for (const e of entries) {
    const known = journal[e.slug];
    if (known && known.contentHash !== e.contentHash) throw new Error(`${e.slug}: the file changed since it was partly published. Remove it from ${journalPath} only if you mean to start that file again.`);
    journal[e.slug] ??= e;
  }
  await save();
  const signer = await loadSigner();
  const client = signer.client;
  console.log(`Publishing as ${await signer.getRecommendedAddress()} with ${ckb(await signer.getBalance())} CKB`);

  for (let round = 1; ; round++) {
    const waiting: Entry[] = [];
    for (const entry of entries.map(e => journal[e.slug])) {
      if (entry.verified) continue;
      const last = entry.segments.at(-1);
      // A segment that was signed or sent but is not confirmed: settle it before doing anything else.
      if (last && last.status !== 'committed') {
        const status = await txStatus(client, last.txHash);
        if (status === 'committed') { last.status = 'committed'; await save(); }
        else {
          if (!['pending', 'proposed'].includes(status)) {
            // Never reached the pool (or fell out): send the SAME signed transaction again.
            await client.sendTransaction(ccc.Transaction.fromBytes(last.signed)).catch(error => console.log(`  ${entry.slug}: resend refused (${String(error).slice(0, 120)})`));
            last.status = 'broadcast'; await save();
          }
          waiting.push(entry); continue;
        }
      }
      const done = entry.segments.reduce((sum, s) => sum + s.length, 0);
      if (done >= entry.bytes) {
        const file = await resolveV3(entry.typeId!, { client, maxBytes: 16 * 1024 * 1024 });
        if (file.size !== entry.bytes || ccc.hashCkb(file.fileBytes) !== entry.contentHash || file.contentType !== entry.contentType)
          throw new Error(`${entry.slug}: on-chain bytes do not match the local file. Stopping; inspect ${entry.typeId}.`);
        entry.verified = true; await save();
        console.log(`  ✓ ${entry.slug} verified on chain: ${entry.typeId} (${entry.segments.length} tx)`);
        continue;
      }
      const content = new Uint8Array((await readFile(join(dir, entry.file))).subarray(done, done + SEGMENT_BYTES));
      const persistSigned = async (record: { txHash: string; typeId: string; transaction: string }) => {
        entry.typeId ??= record.typeId;
        entry.segments.push({ offset: done, length: content.length, txHash: record.txHash, signed: record.transaction, status: 'signed' });
        await save();
      };
      try {
        if (entry.segments.length === 0) await publishV3({ signer, content, filename: entry.file, contentType: entry.contentType, persistSigned });
        else await appendV3({ signer, identifier: entry.typeId!, content, persistSigned });
        entry.segments.at(-1)!.status = 'broadcast'; await save();
        console.log(`  round ${round}: ${entry.slug} segment ${entry.segments.length}/${segmentsFor(entry.bytes)} sent`);
      } catch (error) {
        // Usually a wallet cell still in flight from this round; the next round retries or resends.
        console.log(`  round ${round}: ${entry.slug} deferred (${String(error).slice(0, 160)})`);
      }
      waiting.push(entry);
    }
    if (!waiting.length) break;
    const started = Date.now();
    for (;;) {
      const open = waiting.filter(e => { const s = e.segments.at(-1); return s && s.status !== 'committed'; });
      for (const e of open) if (await txStatus(client, e.segments.at(-1)!.txHash) === 'committed') e.segments.at(-1)!.status = 'committed';
      await save();
      if (open.every(e => e.segments.at(-1)!.status === 'committed')) break;
      if (Date.now() - started > COMMIT_TIMEOUT_MS) { console.log('  still unconfirmed after 15 minutes; starting the next round, which resends what is missing'); break; }
      await sleep(POLL_MS);
    }
  }
  const pointers = Object.fromEntries(entries.map(e => journal[e.slug]).map(e => [e.slug, { typeId: e.typeId, contentHash: e.contentHash, bytes: e.bytes, contentType: e.contentType }]));
  await writeFile(join(dir, 'onchain.json'), JSON.stringify(pointers, null, 1));
  console.log(`\nAll ${entries.length} files verified. Pointers written to ${join(dir, 'onchain.json')}`);
  console.log(`Remaining balance: ${ckb(await signer.getBalance())} CKB`);
}

const [command, manifest] = process.argv.slice(2);
const needManifest = () => { if (!manifest) throw new Error('Pass the manifest path.'); return manifest; };
const task = command === 'new-key' ? newKey() : command === 'address' ? showAddress()
  : command === 'plan' ? plan(needManifest()) : command === 'run' ? run(needManifest())
  : Promise.reject(new Error('Usage: publish-music.ts new-key | address | plan <manifest> | run <manifest>'));
task.catch(error => { console.error(String(error instanceof Error ? error.message : error)); process.exitCode = 1; });
