# CKBFS AI HTML Jukebox — implementation checkpoint

Canonical V3 storage is proven on Pudge, including empty, multi-witness and two-append browser-signed round trips. Registry creation, a Type ID-preserving revision 2 update, and revision 3 rollback are verified. The isolated player, persistent admin pipeline, cache and Three.js gallery are implemented; the complete Orbit Study demo → manifest → registry publication is now independently verified on Pudge.

```sh
npm ci
npm run dev
```

Open the printed localhost URL for the jukebox. Use the Service panel link (or `#service`) to publish and inspect chain diagnostics. Use a funded **Pudge JoyID** wallet for signing. No private key is requested or stored.

See [operator instructions](docs/OPERATOR.md), [validation evidence](docs/VALIDATION.md), and [source attribution](ATTRIBUTION.md).

---

# CKBFS AI HTML Jukebox — Coding Agent Handoff

Research/version lock date: **2026-09-11**
Target chain: **Nervos CKB Testnet / Pudge**
Initial hosting: **Cloudflare Pages**
Primary wallet/admin signer: **JoyID via CCC**

## Product

Build a dedicated web application for browsing and launching AI-generated HTML demos stored through CKBFS on CKB testnet.

The public interface should feel like a physical **retro jukebox crossed with a modern RetroArch-style library selector**. Three.js provides the cabinet/environment/animation, while DOM UI provides readable text, search, accessibility, admin controls, and status.

The application has two major modes:

1. **Public Jukebox**
   - loads an on-chain catalog;
   - browses categories and demos;
   - resolves HTML from CKBFS;
   - verifies content;
   - launches demos in an isolated iframe;
   - caches previously verified demos locally.

2. **Owner Service Panel**
   - connects JoyID;
   - selects local HTML;
   - runs a portability/capability scan;
   - previews the exact file locally using the production sandbox;
   - publishes through CKBFS V3;
   - resolves and verifies the uploaded bytes;
   - publishes a new immutable manifest;
   - updates a singleton Type ID registry cell.

No application database or backend is required.

## Read first

1. `VERSION_LOCK.md`
2. `AGENT_MASTER_PROMPT.md`
3. `PROTOCOL_REPAIR.md`
4. `REGISTRY_AND_MANIFEST.md`

## Existing/reference repositories

- https://github.com/toastmanAu/ckbfs-viewer
- https://github.com/toastmanAu/ckbfs-browser
- https://github.com/code-monad/ckbfs
- https://github.com/code-monad/ckbfs-api
- https://github.com/ckb-devrel/ccc

## Critical implementation rule

**All new CKBFS writes use protocol V3 `20250821.4ee6689bf7ec`.**

Do not infer protocol version from:
- `@ckbfs/api` package version;
- README wording;
- CCC version;
- existing V2 constants in older local code.

The handoff pins the protocol and deployment constants explicitly.
