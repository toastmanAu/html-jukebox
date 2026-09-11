# Validation checkpoint — 2026-09-11

## Passed

- Production build with TypeScript strict mode and Vite.
- 55 unit/integration tests, including all six public API implementations, byte-level golden vectors, empty/single/two/many-witness content, multiple appends, corruption/bounds checks, actual CCC transaction construction and durable broadcast recovery.
- Eight Playwright desktop/mobile unsigned UI checks: no runtime errors on cold load, no horizontal overflow, disconnected signing gate, RPC diagnostic visibility, JoyID dialog, proof selection and no iframe/main-DOM execution of arbitrary source.
- One additional live Chromium test passed against the real Pudge RPC: deployment preflight and independent browser resolution of a 10,495-byte V3 file.
- Real Pudge deployment preflight. Dep group output 0 is live and committed. Both code cells match the locked data hash, Type ID hash and deployment references. Evidence: `evidence/pudge-deployment.json`.
- Five real existing Pudge V3 files independently resolved. Includes 908,997 bytes across 30 transactions and a separate history with head witness index zero. Every segment's cumulative checksum and consumed predecessor were checked. Evidence: `evidence/pudge-existing-files.json`.

The deployment test fixture contains exact serialized public transactions captured from Pudge; it does not contain wallet credentials. Existing-file evidence stores metadata, hashes and provenance, not the file bytes.

## Still required for Phase 1 acceptance

The browser-signed single-witness HTML proof passed on Pudge: transaction `0xe60b95a87a3f040c2a4b50caa226f682afac3d31c4dda23c5dddc112c44a9998` is committed, and all 159 bytes match the fixture exactly. Adler32 and CKB Blake2b both match. Evidence: `evidence/pudge-browser-small.json`.

The multi-witness HTML, append sequence and empty-file browser proofs remain required. The offline signer/chain integration tests do not establish Pudge contract acceptance of newly built transactions. The workbench implements these remaining proof operations and evidence export; their signed transaction evidence is still pending.

Registry, manifests, production sandbox player, complete admin pipeline, Three.js cabinet and Cloudflare production deployment are not implemented. Those phases remain gated by the handoff's storage proof requirement.

## Dependency/build limits

CCC remains pinned exactly at core 1.19.1 and connector-react 1.1.9, with npm lockfile. Development tooling was updated to remove high/critical audit findings. The final audit reports 21 low and 2 moderate findings (the moderate findings affect Vitest development tooling); none high or critical. No forced CCC upgrade was applied. Reassess these before production.

The proof bundle includes the wallet connector and is approximately 1.03 MB uncompressed / 328 KB gzip. Vite reports a chunk-size advisory. Public catalog/wallet lazy loading and mobile GPU performance are later-phase work; no mobile performance claim is made from browser emulation.
