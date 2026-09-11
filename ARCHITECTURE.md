# Architecture

## Public read path

```text
Static Cloudflare Pages app
        |
        v
configured Jukebox Registry TypeID
        |
        v
find live registry cell
        |
        v
decode registry data
        |
        +--> manifest CKBFS TypeID
        +--> manifest cryptographic hash
        |
        v
resolve manifest through CKBFS V3
        |
        v
verify hash + schema
        |
        v
render catalog
        |
        v
select demo
        |
        v
cache lookup by TypeID + contentHash
        |
        +---- hit ----> launch
        |
        `---- miss ---> resolve V3 -> verify -> cache -> launch
```

## Admin write path

```text
JoyID signer
  |
  +-> testnet check
  +-> signer lock == registry lock
  |
local HTML
  |
portability scan
  |
production-sandbox preview
  |
CKB cryptographic content hash
  |
publish CKBFS V3
  |
resolve from chain
  |
verify exact content
  |
build manifest revision N+1
  |
publish manifest to CKBFS V3
  |
resolve + verify manifest
  |
consume registry cell
  |
recreate SAME Type ID
  |
point to manifest N+1
```

## Responsibilities

### Three.js layer

Owns:
- cabinet/world
- lighting
- materials
- selector mechanism
- background ambience
- camera motion
- non-essential visual effects

Does not own:
- large text
- admin forms
- wallet state
- error messages
- search input
- accessible controls

### DOM layer

Owns:
- titles/descriptions
- search/categories
- selected-demo metadata
- admin UI
- player toolbar
- accessibility
- settings
- network and verification state

## Network

Support:
- default public Pudge client;
- custom RPC/indexer endpoint in local settings;
- future LAN/local node configuration.

Never store custom endpoints on chain.

## Testnet guard

Publishing must assert:
- client = testnet/Pudge;
- V3 testnet constants selected;
- admin UI clearly says TESTNET;
- mainnet writes disabled at code/config level initially.

## WebGL fallback

If WebGL is unavailable, show a functional 2D catalog. Public catalog/player behavior should not depend on the 3D scene being present.
