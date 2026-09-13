# Pudge storage proof operator guide

This is the Phase 0/1 workbench. It does not yet provide the public jukebox, registry, arbitrary demo upload, production player or full admin state machine. Do not deploy it as the finished product.

## Run locally

Use Node 22.14 or newer and npm. Run `npm ci`, then `npm run dev`. The default URL is http://127.0.0.1:5173/. JoyID needs a normal browser with passkey/popup support. Localhost or HTTPS is required. The journal additionally requires IndexedDB and Web Locks; unsupported contexts show an explicit error.

The wallet selector only offers JoyID, and only Pudge is configured. The module verifies both the `ckt` address prefix and the public Pudge genesis hash; labeling a mainnet RPC “testnet” is insufficient.

## Mandatory signed proof

1. Run **Verify Pudge deployment**. Both the locked V3 code cell and Adler32 code cell must match. Do not change the constants to make a failed check pass.
2. Connect a funded Pudge JoyID wallet using dedicated test funds. Keep enough available capacity for multiple file cells plus change. The exact locked capacity and fee appear before each signature.
3. Select **Single-witness HTML**, then **Prepare & estimate**. Review the network, file operation, bytes, chunk count, locked capacity and fee. Select **Sign & broadcast on Pudge** to request the wallet signature.
4. After broadcast, use the transaction explorer link. Once committed, choose **Verify committed bytes**. Verification uses a fresh RPC client and checks byte-for-byte equality, cumulative Adler32 and CKB Blake2b.
5. Repeat for **Multi-witness HTML**. Then verify **Append to the same Type ID**, followed by **Append a second segment**. Each append requires its predecessor to be verified and unchanged on chain.
6. Run the empty-file proof. Export proof evidence after all five entries show `verified`.
7. Place the exported JSON in `evidence/pudge-browser-proof.json` and review the on-chain transactions before accepting Phase 1 and proceeding to the registry phase.

The signatures are real transactions. Newly created CKBFS cells remain on-chain. The program does not generate, request, log or store private keys.

## Interrupted or uncertain broadcast

The full signed transaction, expected bytes, hash and Type ID are atomically persisted before broadcast. If the browser closes or the RPC times out after signing, reload the same origin and use **Recover same transaction**. Recovery first queries the known hash. Committed, pending or proposed transactions are not resent; otherwise it rebroadcasts the identical signed transaction without another upload or signature. Then verify committed bytes.

Do not clear browser site data during a proof. Switching between `localhost` and `127.0.0.1`, ports or browsers changes the journal origin. Keep the same origin and browser until evidence is exported. The journal blocks replacing an already signed proof with a new transaction. There is intentionally no automatic “start over” upload action.

The phase-1 journal is not the later `ADMIN_STATE_MACHINE.md` catalog pipeline. Registry concurrency, manifest recovery and rollback must be added in their gated phases.

## Public API

Import from `src/ckbfs/index.ts`:

- `verifyV3Deployment(client)` fetches committed transactions without CCC transaction-cache fallback, decodes the dep group, checks live cells and hashes code bytes.
- `parseCKBFSIdentifier(input)` accepts a bare 32-byte Type ID, `ckbfs://testnet/<TypeID>`, or explicit `txHash:index`. A bare transaction hash is not guessed to be a transaction. Outpoints must still be live; use Type ID to resolve the latest appended state.
- `resolveV3(identifier, { client, maxDepth?, maxChunks?, maxBytes? })` returns bytes, metadata and oldest-first provenance. Defaults: 128 segments, 4,096 chunks, 32 MiB. All historical output metadata, input consumption, checksums and immutable filename/MIME fields are checked.
- `estimateV3Publish(content, lock, opts)` requires a signer plus filename/contentType in `opts`, because it builds the real witness-bearing transaction. It collects inputs but does not sign, broadcast or reserve them on chain. All capacity/fee values are decimal shannon strings.
- `publishV3({ content, filename, contentType, signer, persistSigned, beforeSign?, ...limits })` builds, signs, persists and broadcasts. A result reports **broadcast**, not confirmed. Independently resolve after commitment.
- `appendV3({ identifier, content, signer, persistSigned, beforeSign?, ...limits })` resolves and checks the current state, consumes that cell, preserves its exact Type ID/lock/filename/MIME and appends a backlink segment.

`persistSigned` is mandatory and must durably save its record before returning. Throwing prevents broadcast. `beforeSign` permits a caller to present the final estimate. The workbench instead uses exported `prepareV3`/`broadcastPreparedV3` to separate estimate and signature UI actions.

A conservative 100,000-byte limit applies to the serialized transaction including wallet witness preparation and fee/change completion; it cannot be raised above the ceiling through options. A second check runs after signing. Large automatic multi-transaction splitting is not implemented: the module rejects an oversized segment before signature, and explicit append operations retain the same Type ID. Default chunk payload is 16 KiB. A single witness containing empty content is supported.

## Read-only verification

`npm run verify:pudge` refreshes `evidence/pudge-deployment.json`. `PUDGE_RPC=https://... npm run verify:pudge` checks another RPC against the same Pudge genesis and deployment pins. This environment variable is for the Node diagnostic only; browser endpoint preferences belong to a later phase.

`npx tsx scripts/resolve-existing.ts` samples five existing V3 live cells and writes checksums/hashes/provenance to `evidence/pudge-existing-files.json`. This does not publish and does not execute their content.

## Tests and next phases

- `npm test`: codec, malformed-chain, actual CCC transaction-builder, deployment-fixture and IndexedDB recovery tests.
- `npm run test:e2e`: desktop/mobile unsigned proof UI tests. Live RPC test is opt-in.
- `PUDGE_LIVE=1 npm run test:e2e -- --grep 'live Pudge' --project=chromium`: live browser preflight and resolution.
- `npm run build`: strict TypeScript check and static Vite build into `dist`.

Once the signed proof passes, implement Phase 2 registry/manifest, Phase 3 isolated player, Phase 4 complete admin pipeline, Phase 5 cabinet UX, then Phase 6 Cloudflare Pages headers/CSP and full production tests. Generate the registry Type ID from the first real registry transaction; never invent it. No Cloudflare deployment or registry creation has been performed in this checkpoint.

## Registry and complete demo publishing

The Pudge singleton Type ID is already saved in `config/jukebox.ts`. Do not create a second registry. Creation, update to revision 2, and rollback to revision 3 have independently verified evidence under `evidence/`. Revision 3 points to the original empty manifest; registry and manifest revision numbers need not match after rollback.

For the first complete demo acceptance run:

1. In the immutable demo service panel, connect the owner JoyID. Saving a new draft automatically loads and authorizes the current registry; **Load & authorize owner registry** remains available as a diagnostic check.
2. Select `examples/orbit-study.html` (or a self-contained HTML file), review metadata and capabilities, and choose **Save inspected publish draft**.
3. Open the production sandbox preview, test it, return, and choose **Preview works — approve these exact bytes**.
4. **Continue next safe step** prepares the demo transaction. Review the capacity/fee and sign it.
5. After commitment, continue to independently resolve and verify it. Continue again to prepare, review, and sign the immutable manifest.
6. After commitment, continue to verify that manifest, then prepare, review, and sign the registry update.
7. Continue once more to re-query the registry until the draft reports **COMPLETE**. Open `#jukebox` to load and play the verified title.

Every signed transaction is persisted before broadcast. Reloading the page restores drafts. **Recover known transaction** re-queries its hash before considering rebroadcast of the same signed transaction. Never create a new draft merely because a later transaction failed. A changed registry is an explicit conflict and does not authorize uploading the same demo again.

## Player and Cloudflare Pages

Build with `npm run build`; configure Cloudflare Pages with build command `npm run build` and output directory `dist`. The application needs no server-side wallet secrets. The production build is deployed at https://html-jukebox.pages.dev. The custom domain https://htmljukebox.online is active with HTTPS.

Deploy `public/_headers`, `sandbox.html`, and `sandbox.js` together with the build. The host CSP keeps scripts restricted to self. Only the dedicated sandbox page permits demo script execution; its response is itself sandboxed, and the nested demo iframe uses capability-specific CSP with no same-origin permission. Cloudflare redirects `/sandbox.html` to `/sandbox`, so both paths require their scoped headers. Do not collapse their rules into the main page's policy.

Previously verified catalog and demo bytes are stored in IndexedDB. Offline cache entries are checked against the manifest content hash before playback. Browser storage can be evicted; Settings offers a persistence request, whose result depends on the browser. There is no shell service worker yet, so offline use requires an already loaded app shell.

## Public gallery entry point

The root URL now opens the jukebox. The Service panel link opens `#service` and loads wallet/admin code on demand. The publishing panel appears before historical registry proof controls. Use the saved demo draft for publishing; the registry proof panel can publish catalog-only revisions and should not be used as a substitute for the demo workflow.

The title list supports arrows, Home/End, and Enter to play. Search, categories, favorites and reduced-motion settings are available in the DOM. Downloaded means bytes are stored locally; they are cryptographically checked again at launch. Use Settings → Refresh on-chain catalog to check for updates or retry after reconnecting. RPC failure can show OFFLINE / LAST VERIFIED and allow downloaded titles. No shell service worker is installed, so keep the app loaded for offline use.

## Service panel authorization

Opening `#service` now shows a JoyID login gate. The actual service UI is mounted only after the connected recommended JoyID lock is checked against Pudge and the live registry owner. Disconnecting or changing signer removes access. Registry lookup failures fail closed.

The current on-chain owner is automatically admitted. Additional panel-access lock hashes can be explicitly configured in `config/admin.ts`; five operator-supplied Pudge JoyID addresses are configured, including the existing owner. Decode each approved `ckt` address with the pinned CCC client and store its full script hash, not just its args. This list controls app UI access, not on-chain authority: those accounts cannot consume the owner-locked registry. Supporting several independent registry-signing accounts requires an explicitly designed ownership/delegation change.

The public gallery remains wallet-free. No private keys or authentication credentials are stored in admin configuration.


## Production release

Public source: https://github.com/toastmanAu/html-jukebox (branch `master`). Pages project: `html-jukebox`. This is a Direct Upload project; pushing GitHub commits does not automatically deploy it.

To release a checked build using an authenticated local Wrangler session:

```sh
npm ci
npm run build
npx --yes wrangler@4.45.0 pages deploy dist --project-name html-jukebox --branch master
```

Test the hosted release:

```sh
PUDGE_LIVE=1 E2E_BASE_URL=https://html-jukebox.pages.dev npm run test:e2e
```

The custom domain has a Pages binding. Its DNS record should be a proxied apex CNAME (`@`) targeting `html-jukebox.pages.dev`; assigned authoritative nameservers are `alexia.ns.cloudflare.com` and `arnold.ns.cloudflare.com`. Cloudflare subsequently confirmed the zone and custom domain active, and HTTPS was verified. Some recursive DNS caches may temporarily retain the former registrar address.

Each origin has separate IndexedDB storage. The live site reads the same on-chain registry, but localhost drafts and cached demo bytes do not migrate automatically. Connect JoyID again on the public origin; do not restart a completed local publish draft to migrate it.

## Large single-file HTML (including inlined Three.js)

The demo workflow automatically publishes files above 80 KiB as an initial V3 segment followed by appends to the same Type ID. The 80 KiB budget is a starting point; every prepared transaction is serialized and checked against the unchanged 100,000-byte ceiling. If wallet/input overhead exceeds that ceiling, the candidate segment is reduced before signing. Total file size is capped at the resolver's 32 MiB limit.

An existing draft that failed with CONTENT_TOO_LARGE before broadcast can be resumed: refresh the same site/origin, select that saved draft, and choose Continue next safe step. No new draft or file edit is necessary. Review and sign each segment, wait for commitment, then continue to verify its cumulative bytes. Continue again to prepare the next append. Around 712 KB normally requires nine demo signatures, plus the manifest and registry signatures.

Every signed segment is persisted before broadcast. Recover known transaction re-queries the most recent receipt; it never starts the file again. The manifest is created only after independently resolving the complete witness history and matching every byte and the original cryptographic hash. Published segments remain on-chain if a later step fails; keep the draft to resume them.

After signing, a brief confirmation/indexer wait is normal. TRANSACTION_NOT_COMMITTED means wait and continue; INDEXER_SYNC_PENDING means the output is committed/live but discovery is catching up, so wait briefly and continue without signing again. TRANSACTION_UNAVAILABLE directs you to Recover known transaction using the saved receipt. Share the links labeled Transaction receipt when reporting a broadcast; the File content hash identifies bytes and is not an explorer transaction hash.

If an older release reports CONTENT_HASH_MISMATCH immediately after an append, refresh and resume the same saved draft. The current release checks commitment and the exact signed transaction head before comparing bytes, avoiding comparison against a still-live predecessor. Continue first verifies the existing receipt without signing. A remaining CONTENT_HASH_MISMATCH is an integrity failure: retain the draft and receipts for investigation; do not bypass it or start a replacement upload.

## Shared play counts

The host records one play after the isolated demo iframe loads. Reopening a demo or pressing Reload demo counts again; selection, byte downloads, failed verification, and admin previews do not. Counts are keyed by the demo's CKBFS Type ID and shared across visitors. Counting starts when this feature is deployed; historical plays cannot be reconstructed.

Cloudflare Pages Functions serves `/api/plays` using a D1 binding named `PLAYS`. Create a database with `wrangler d1 create html-jukebox-plays`, add its returned ID to `d1_databases` in `wrangler.jsonc`, then apply `migrations/0001_plays.sql` with `wrangler d1 migrations apply html-jukebox-plays --remote` before deploying. Local Pages testing uses the same migration with `--local`. Cloudflare authorization needs `d1:write` in addition to existing Pages access. Vite alone does not serve this API; use the Pages emulator for database testing.

Each load sends an anonymous random UUID. A unique receipt and SQL trigger make increments atomic and retries idempotent. No cookies, IP addresses, wallet addresses, or persistent visitor IDs are stored by this counter. Receipts are retained to deduplicate retries. The POST endpoint rejects other origins, including the opaque demo sandbox. Counts measure reported loads, not unique people or verified engagement; a determined API client can inflate them. An iframe load event does not guarantee all demo code or external resources worked.

Play counts are auxiliary off-chain data; CKBFS files, manifests, and registry transactions are unchanged. Counter failure never blocks playback; the gallery displays unavailable counts or an unsaved-play message. Offline plays are not queued for later upload. Cloudflare Pages Functions and D1 usage count toward the account's applicable quotas.
