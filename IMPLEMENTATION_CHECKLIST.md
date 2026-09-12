# Implementation Checklist

**Acceptance:** browser-signed Pudge storage proofs, registry creation/update/rollback, and the complete Orbit Study publication are verified. Registry revision 4 is configured; evidence is in `evidence/`. Desktop/mobile browser acceptance includes live playback and cached replay. Public Cloudflare deployment and real-device GPU profiling remain.

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
- [x] Legacy V2 code not retained.

## Registry
- [x] Molecule schema.
- [x] Registry creation.
- [x] Registry discovery.
- [x] Registry decode.
- [x] Owner lock verification.
- [x] Registry update preserving Type ID.
- [x] Re-query verification.
- [x] Rollback.

## Catalog
- [x] Manifest schema v1.
- [x] Zod/validator.
- [x] Cryptographic content hash.
- [x] `previous` history pointer.
- [x] Stable item IDs.
- [x] hidden/archived support.

## Player
- [x] Isolated iframe.
- [x] Capability policy.
- [x] Host toolbar.
- [x] fullscreen.
- [x] cache integration.
- [x] srcdoc lifecycle cleanup; player creates no Blob URLs.
- [x] return-to-selection behavior.

## Admin
- [x] JoyID connection.
- [x] Pudge hard guard.
- [x] signer lock check.
- [x] upload file picker.
- [x] portability scanner.
- [x] local production-sandbox preview.
- [x] cost/size estimate.
- [x] resumable publish state machine.
- [x] explorer links.
- [x] recovery after reload.

## Jukebox
- [x] Three.js cabinet.
- [x] responsive camera.
- [x] mechanical selector.
- [x] touch navigation.
- [x] keyboard/mouse/wheel.
- [x] search/category DOM UI.
- [ ] Full cinematic launch transition (mechanical selection response implemented).
- [x] reduced motion.
- [x] 2D/WebGL fallback.

## Deployment
- [x] Cloudflare Pages build.
- [x] `_headers`.
- [x] CSP reviewed against real demos.
- [x] IndexedDB cache.
- [x] offline last-verified mode.
- [x] source/licenses.
- [x] operator documentation.

## Remaining release work
- [x] Public Cloudflare Pages deployment and hosted smoke test.
- [ ] Custom domain DNS/TLS activation and wallet-holder public-origin JoyID sign-in.
- [ ] Physical mobile-device GPU profiling (DPR capped; demand rendering enabled).
- [ ] Optional offline shell service worker.
