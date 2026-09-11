# Cache and Offline

IndexedDB database:
`ckbfs-jukebox-v1`

## Stores

### manifests
Key: manifest CKBFS Type ID

Value:
- typeId
- contentHash
- exact bytes or validated object
- fetchedAt

### demos
Key:
`${typeId}:${contentHash}`

Value:
- typeId
- contentHash
- contentType
- filename
- Blob/bytes
- byteLength
- fetchedAt
- lastPlayed

### preferences
- favorites
- last category
- reduced motion
- volume
- custom RPC
- cache policy

### adminDrafts
Resumable transaction workflow state only.

## Startup freshness

Registry is the root of freshness.

1. Load registry from chain.
2. Compare its manifest Type ID/hash to cached active manifest.
3. Reuse exact matching cache.
4. Otherwise retrieve and verify new manifest.

## Offline

If chain RPC is unavailable:
- show last verified cached manifest;
- clearly label `OFFLINE / LAST VERIFIED`;
- allow locally cached demos to launch;
- disable publishing/admin writes.

Optional user action:
`navigator.storage.persist()` for “Keep downloaded demos offline”.

A service worker may cache the shell, but IndexedDB is the explicit demo/content cache.
