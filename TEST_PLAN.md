# Test Plan

## Unit tests

### CKBFS
- V3 metadata encoding/decoding
- head witness encoding/decoding
- continuation witness encoding/decoding
- nextIndex chain traversal
- backlink traversal
- Adler32
- malformed witness handling
- identifier parsing
- content hash
- transaction size calculation

### Registry
- Molecule encode/decode
- revision validation
- Type ID preservation
- connected lock comparison

### Manifest
- schema validation
- duplicate item IDs
- invalid Type IDs/hashes
- bad previous pointer
- unsupported schema

### Portability scanner
fixtures for:
- fully inline HTML
- CDN-only HTML
- relative GLB
- relative audio
- ES module relative import
- CSS relative URL
- false-positive minimization

## Chain integration tests — Pudge

Mandatory:
1. verify V3 deployment constants.
2. publish small HTML.
3. resolve exact bytes.
4. publish multi-witness HTML.
5. resolve exact bytes.
6. append V3 content across transaction(s).
7. resolve exact cumulative bytes.
8. create registry Type ID.
9. locate registry by Type ID.
10. update registry preserving Type ID.
11. confirm signer lock controls update.
12. publish manifest and retrieve/verify it.

Use dedicated test cells/funds.

## Player tests

- verified HTML runs
- host toolbar survives demo behavior
- demo cannot navigate parent
- fullscreen works when permitted
- geolocation blocked unless granted
- Blob URL revoked on unload
- back returns to same jukebox selection
- cached demo launches without refetch

## Admin recovery tests

Simulate interruption after:
- demo publish
- demo verify
- manifest publish
- manifest verify
- registry broadcast

Reload app and ensure no duplicate upload.

## E2E

Playwright target flows:
- cold public load
- catalog browse
- search
- launch demo
- return
- cached relaunch
- wrong wallet
- disconnected wallet
- no registry
- offline cached mode

Wallet popup signing may require manual/semi-automated smoke tests depending on JoyID automation constraints.

## Performance

Test representative Android/mobile device class.

Targets:
- responsive touch interaction
- no runaway GPU use in idle
- reasonable memory after repeatedly launching/closing demos
- Three.js scene suspended or reduced while demo runs
- DPR/effects adapt to device
