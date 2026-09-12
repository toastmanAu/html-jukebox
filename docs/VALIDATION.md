# Validation checkpoint — 2026-09-11

## Passed

- Production build with TypeScript strict mode and Vite.
- 94 unit/integration tests, including all six public API implementations, byte-level golden vectors, empty/single/two/many-witness content, multiple appends, corruption/bounds checks, actual CCC transaction construction and durable broadcast recovery.
- Fourteen Playwright desktop/mobile checks passed (two opt-in live RPC cases skipped), including: no runtime errors on cold load, no horizontal overflow, disconnected signing gate, RPC diagnostic visibility, JoyID dialog, proof selection and no iframe/main-DOM execution of arbitrary source.
- One additional live Chromium test passed against the real Pudge RPC: deployment preflight and independent browser resolution of a 10,495-byte V3 file.
- Real Pudge deployment preflight. Dep group output 0 is live and committed. Both code cells match the locked data hash, Type ID hash and deployment references. Evidence: `evidence/pudge-deployment.json`.
- Five real existing Pudge V3 files independently resolved. Includes 908,997 bytes across 30 transactions and a separate history with head witness index zero. Every segment's cumulative checksum and consumed predecessor were checked. Evidence: `evidence/pudge-existing-files.json`.

The deployment test fixture contains exact serialized public transactions captured from Pudge; it does not contain wallet credentials. Existing-file evidence stores metadata, hashes and provenance, not the file bytes.

## Browser-signed Phase 1 acceptance — passed

The browser-signed single-witness HTML proof passed on Pudge: transaction `0xe60b95a87a3f040c2a4b50caa226f682afac3d31c4dda23c5dddc112c44a9998` is committed, and all 159 bytes match the fixture exactly. Adler32 and CKB Blake2b both match. Evidence: `evidence/pudge-browser-small.json`.

The browser-signed multi-witness HTML proof also passed: transaction `0x319bf794b020d58c88782a81e550867e382ef748ec6f983753f58e5d99234677` is committed. Its four witnesses reconstruct all 49,666 fixture bytes exactly; Adler32 and CKB Blake2b both match. Evidence: `evidence/pudge-browser-multi.json`.

The first browser-signed append passed: transaction `0x1c2bcafc117191a4bb2f1094f0b0b652e579eeec7fbfbf92b438bb7bb9334c96` is committed and preserves the original Type ID. The two-transaction history reconstructs exactly 66,697 bytes across six witnesses, with matching cumulative Adler32 and CKB Blake2b. The append head is at witness index 2, confirming correct placement with multiple inputs. Evidence: `evidence/pudge-browser-append-1.json`.

The second browser-signed append passed: transaction `0xd47bcdbf1c79217821ac94070d940f1a5232ea9c8190309bc222cdaee0a36315` is committed and preserves the same Type ID. All 83,728 bytes across eight witnesses and three transactions match the cumulative fixture exactly. Both backlinks, cumulative Adler32 and CKB Blake2b verify. Evidence: `evidence/pudge-browser-append-2.json`.

The empty-file browser proof also passed: `0x57f1ea2429fa6b8d6a4ec15d432b44f563fcca1ef1c0daafbca416bbb8bdc750`. Zero bytes, Adler32 1, and exact content hash verified. Evidence: `evidence/pudge-browser-empty.json`.

## Registry and manifest

Initial manifest and registry creation are independently verified. The generated singleton Type ID is saved in `config/jukebox.ts`: `0x82c99d7df1c19baa0cedacaafb72f4118fd8e4ba5eab9bc953d08fef72954f15`.

Manifest revision 2 preserves the collection and points to revision 1 through a verified historical hash. Registry update `0xcd7519fe6d88550b444aa1e7ff4bdf7d8a47995082d197f677dab80be46e6576` consumes the exact revision 1 cell, preserves its Type ID and owner lock, and points to the independently verified manifest 2. Evidence: `evidence/pudge-registry-update-2.json`. Rollback transaction `0x4a0f3ca09686d8d19045a8b3927bb3ae7c1ffaaf5c115aa20935038e82a773c4` is committed: registry revision 3 preserves the same Type ID/owner and points back to verified manifest revision 1. Evidence: `evidence/pudge-registry-rollback-3.json`. Phase 2 on-chain acceptance is complete.

## Player, admin and gallery

Player and persistent admin state machine are implemented. Tests cover byte/hash verification, cache corruption, portability, owner authorization, transitions and successful-upload preservation. Two Chromium player tests passed against a local Cloudflare Pages emulator using the real `_headers`: inline scripts execute in the nested sandbox, host DOM access fails, unapproved fetches produce no outgoing request, reload/exit work, and relative dependencies block publication. Cloudflare canonicalizes `/sandbox.html` to `/sandbox`; both paths have scoped sandbox headers. The main document keeps `script-src 'self'`.

The gallery is the default at `/` and `#jukebox`; the owner service panel is at `#service`. Desktop screenshot inspection found no runtime error or overflow. The corrected 390px mobile layout also has no horizontal overflow. The catalog contains the genuinely published Orbit Study title; local fixtures are not presented as additional on-chain entries. The full admin pipeline has now published Orbit Study: transaction `0x0ec1967e7fd9b0489ffb969269a2c3752541455f13d7c63c52a3d255121f061c` is committed. All 2,999 bytes independently resolve exactly to `examples/orbit-study.html`, with matching Adler32 and CKB Blake2b hash. Evidence: `evidence/pudge-orbit-study-demo.json`. Manifest revision 4 is independently verified in `evidence/pudge-manifest-4.json`. Final registry transaction `0xa8508575bbda7794cbcaee556b963ef55517ee9f016e88822248a795408fdc47` is committed: revision 4 preserves the exact singleton Type ID and owner lock and points to the manifest containing Orbit Study. Evidence: `evidence/pudge-registry-update-4.json`. The separate empty manifest publication `0x3ef75953993c36190875ff3d90e72a20110df77904061f7791c684387cc0b29a` was diagnosed and is not referenced by the registry. Two opt-in Playwright tests passed against the real deployed Pudge catalog, in desktop Chromium and mobile emulation: registry revision 4 loaded, Orbit Study executed inside the production sandbox, pause/resume worked, exit removed the iframe, and verified cached replay succeeded with the chain RPC blocked. No runtime errors or horizontal overflow were observed. The operator can now click Continue next safe step in the saved draft to record its final COMPLETE state locally.

The production build is now deployed at https://html-jukebox.pages.dev (initial deployment https://80ebe5a3.html-jukebox.pages.dev). All eight hosted desktop/mobile browser tests passed, including real on-chain catalog playback, cached replay, sandbox isolation, locked service access, and JoyID login UI. Custom domain htmljukebox.online is attached but awaiting DNS activation. Actual owner JoyID login/signing on the public origin still requires the wallet holder.

## Dependency/build limits

CCC remains pinned exactly at core 1.19.1 and connector-react 1.1.9, with npm lockfile. Development tooling was updated to remove high/critical audit findings. The final audit reports 21 low and 2 moderate findings (the moderate findings affect Vitest development tooling); none high or critical. No forced CCC upgrade was applied. Reassess these before production.

The entry chunk is approximately 190 KB uncompressed / 60 KB gzip. Public chain/player code is approximately 176 KB gzip; the separately loaded service/wallet chunk is approximately 157 KB gzip and is requested only on entering the service panel. The cabinet is a separate lazy-loaded chunk (approximately 235 KB gzip). Vite reports a chunk-size advisory. Real-device GPU profiling remains; no mobile performance claim is made from browser emulation.

## Public gallery polish checkpoint

The gallery is now the default route; CCC wallet setup is isolated to the lazy service route. Added downloaded labels, tags, catalog refresh/retry, stale-category fallback, a keyboard listbox (arrows/Home/End/Enter), and background focus/scroll isolation during playback. The player restores focus on exit. Eighteen browser tests passed including live Pudge checks, and the expanded desktop/mobile gallery cases additionally verified search, favorites, reduced-motion setting, downloaded status, focus restoration, offline last-verified catalog refresh, and cached replay with the RPC blocked.

The optimized production build also passed six Cloudflare Pages emulator checks across desktop/mobile (live gallery and player security). Final screenshots of the populated gallery were reviewed at 1440px and 390px. The final TypeScript/Vite build and all 94 unit/integration tests passed. These are emulated-browser checks, not measurements from physical mobile hardware.

## Service access gate

The service route now requires a JoyID recommended lock matching the live Pudge registry owner or an explicitly configured additional panel-access lock hash. Five operator-supplied Pudge JoyID addresses were checksum/prefix validated, decoded, and configured by full script hash. The third supplied address matches the existing registry owner. Registry mutation guards remain owner-only. Seven authorization tests cover the owner, allowed non-owner, rejected account, wrong network/genesis, non-JoyID signer, and registry lookup failure; all 101 unit/integration tests pass. The browser suite now tests the locked service deep link and JoyID login directly, with player isolation tested through a verified offline catalog fixture instead of accessing the protected local preview while disconnected.
