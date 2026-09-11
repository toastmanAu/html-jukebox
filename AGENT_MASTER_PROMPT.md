# Master Coding-Agent Prompt

Build the CKBFS AI HTML Jukebox defined by this handoff.

## Prime directive

Do not improvise the chain architecture.

Read and follow:
- `VERSION_LOCK.md`
- `PROTOCOL_REPAIR.md`
- `REGISTRY_AND_MANIFEST.md`
- `PLAYER_SECURITY.md`
- `ADMIN_STATE_MACHINE.md`

Before investing heavily in visuals, prove the chain/storage subsystem on Pudge.

## Phase 0 — bootstrap

Create a clean Vite + React + TypeScript app.

Recommended:
- React
- Vite
- Three.js
- `@react-three/fiber`
- `@react-three/drei`
- exact CCC pins from `VERSION_LOCK.md`
- `idb` or similarly lightweight IndexedDB helper
- Zod or equivalent schema validation
- Vitest
- Playwright

Use bespoke CSS rather than a heavy UI framework.

Static deployment target: Cloudflare Pages.

## Phase 1 — canonical browser CKBFS V3 module

Port/refactor useful concepts from the owner's two CKBFS repos.

Required public API:

```ts
publishV3(opts): Promise<PublishResult>
appendV3(opts): Promise<AppendResult>
resolveV3(identifier, opts): Promise<ResolvedCKBFSFile>
estimateV3Publish(content, lock, opts): Promise<PublishEstimate>
parseCKBFSIdentifier(input): ParsedIdentifier
verifyV3Deployment(client): Promise<DeploymentVerification>
```

Do not proceed until round-trip tests work.

## Phase 2 — registry + manifest

Implement:
- creation of owner-controlled singleton registry using CKB built-in Type ID;
- lookup/decode by registry Type ID;
- update preserving the exact same Type ID;
- connected JoyID lock comparison;
- immutable CKBFS manifest publication;
- manifest cryptographic hash verification;
- historical `previous` pointer;
- rollback by publishing a new registry revision pointing to an earlier valid manifest.

The final registry Type ID is generated on first Pudge deployment, then stored in app config.

## Phase 3 — player

Implement:
- resolve bytes;
- verify CKBFS checksum;
- verify app content hash;
- cache;
- Blob URL / `srcdoc`;
- sandboxed iframe;
- capability-driven iframe policy;
- permanent host toolbar outside iframe;
- proper Blob URL revoke.

Never inject demo HTML into the main React DOM.

## Phase 4 — admin publish state machine

Pipeline:

```text
select file
-> inspect
-> production-sandbox preview
-> hash
-> publish demo
-> independently resolve demo
-> verify bytes/hash
-> construct manifest N+1
-> publish manifest
-> independently resolve manifest
-> verify manifest hash
-> update registry
-> re-query registry
-> complete
```

Every post-broadcast stage is resumable.

Never repeat an already-successful CKBFS upload merely because a later transaction failed.

## Phase 5 — jukebox UX

Visual target:
**1950s jukebox × RetroArch × modern interactive gallery**

Three.js:
- physical cabinet
- curved glass
- chrome/wood/material treatment
- tasteful neon
- warm practical lights
- mechanical selector motion
- cinematic but performant camera transitions
- restrained bloom/particles
- mobile GPU budget

DOM:
- title cards
- search
- category names
- metadata
- settings
- wallet/admin
- errors/status
- accessible controls

Navigation:
- touch/swipe
- keyboard
- mouse
- wheel
- large mobile targets
- reduced-motion mode

Avoid generic dashboard/card-grid design.

## Phase 6 — production

Add:
- Cloudflare Pages `_headers`;
- security headers/CSP appropriate to iframe demo execution;
- testnet-only admin guard;
- IndexedDB cache;
- optional shell service worker;
- unit/integration/e2e tests;
- operator README;
- source attribution/licenses.

## Required stop/error conditions

Never hide:
- V3 deployment mismatch;
- unsupported wallet/browser context;
- wrong network;
- owner lock mismatch;
- unresolved relative file dependencies;
- oversized content when append mode is unavailable;
- invalid witness chain;
- checksum mismatch;
- cryptographic hash mismatch;
- missing registry;
- registry changed underneath an in-progress admin transaction.

Expose actionable diagnostics.
