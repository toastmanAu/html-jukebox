# Implementation Checklist

**Acceptance caveat:** checked protocol implementation items pass offline tests; live deployment and existing-file reads pass. New browser-signed publish/append round trips are still required before Phase 1 acceptance. No registry Type ID exists yet.

## Storage/protocol
- [x] Exact V3 testnet constants committed.
- [x] `verifyV3Deployment` passes.
- [x] Browser-native V3 metadata codec.
- [x] V3 witness codec.
- [x] Multi-witness resolver.
- [x] Cross-transaction backlink resolver.
- [x] V3 publisher.
- [x] V3 append path or explicit safe limit.
- [x] Round-trip fixture tests.
- [ ] Legacy V2 read code isolated if retained.

## Registry
- [ ] Molecule schema.
- [ ] Registry creation.
- [ ] Registry discovery.
- [ ] Registry decode.
- [ ] Owner lock verification.
- [ ] Registry update preserving Type ID.
- [ ] Re-query verification.
- [ ] Rollback.

## Catalog
- [ ] Manifest schema v1.
- [ ] Zod/validator.
- [ ] Cryptographic content hash.
- [ ] `previous` history pointer.
- [ ] Stable item IDs.
- [ ] hidden/archived support.

## Player
- [ ] Isolated iframe.
- [ ] Capability policy.
- [ ] Host toolbar.
- [ ] fullscreen.
- [ ] cache integration.
- [ ] Blob cleanup.
- [ ] return-to-selection behavior.

## Admin
- [ ] JoyID connection.
- [ ] Pudge hard guard.
- [ ] signer lock check.
- [ ] upload file picker/drop zone.
- [ ] portability scanner.
- [ ] local production-sandbox preview.
- [ ] cost/size estimate.
- [ ] resumable publish state machine.
- [ ] explorer links.
- [ ] recovery after reload.

## Jukebox
- [ ] Three.js cabinet.
- [ ] responsive camera.
- [ ] mechanical selector.
- [ ] touch navigation.
- [ ] keyboard/mouse/wheel.
- [ ] search/category DOM UI.
- [ ] launch transition.
- [ ] reduced motion.
- [ ] 2D/WebGL fallback.

## Deployment
- [ ] Cloudflare Pages build.
- [ ] `_headers`.
- [ ] CSP reviewed against real demos.
- [ ] IndexedDB cache.
- [ ] offline last-verified mode.
- [ ] source/licenses.
- [ ] operator documentation.
