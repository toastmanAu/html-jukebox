# Registry and Manifest

## Registry

Use CKB built-in Type ID.

Registry lock:
the owner JoyID recommended lock at creation.

Subsequent write access is naturally controlled because updating the registry consumes the live registry cell.

## Registry schema v1

Preferred Molecule:

```text
array Byte32 [byte; 32];
array Uint32 [byte; 4];
array Uint64 [byte; 8];

table JukeboxRegistryDataV1 {
  version: Uint32,
  revision: Uint64,
  manifest_type_id: Byte32,
  manifest_hash: Byte32,
}
```

Semantics:
- `version = 1`
- `revision` always increases
- `manifest_type_id` points to immutable CKBFS JSON
- `manifest_hash` = cryptographic CKB-style Blake2b hash of exact manifest bytes

## Registry creation

1. Connect JoyID on Pudge.
2. Create registry output with built-in Type ID placeholder.
3. Ensure at least one signer input.
4. Calculate `ccc.hashTypeId(tx.inputs[0], outputIndex)`.
5. Set args.
6. Set data to already-verified manifest revision 1.
7. Complete capacity/fee.
8. Sign/send.
9. Re-query and verify.
10. Save resulting registry Type ID into app config.

## Registry update invariant

Application requires:

```text
1 current registry input
        ->
1 registry output with identical Type ID script
```

Preserve owner lock unless an explicit ownership-transfer feature is intentionally added.

Built-in Type ID permits deletion, so the application must not accidentally construct a delete-only transaction.

## Manifest v1

Example:

```json
{
  "schema": 1,
  "revision": 12,
  "createdAt": "2026-09-11T05:30:00.000Z",
  "collection": {
    "id": "ai-html-jukebox",
    "name": "AI HTML Jukebox",
    "description": "Interactive HTML demos stored through CKBFS."
  },
  "previous": {
    "typeId": "0x...",
    "contentHash": "0x..."
  },
  "items": [
    {
      "id": "ckb-volcano",
      "title": "CKB Volcano",
      "description": "Nervos blocks rendered as volcanic eruptions.",
      "category": "Nervos Visualizers",
      "tags": ["CKB", "Three.js", "blocks"],
      "ckbfs": {
        "protocol": "20250821.4ee6689bf7ec",
        "typeId": "0x...",
        "txHash": "0x..."
      },
      "contentHash": "0x...",
      "filename": "ckb-volcano.html",
      "contentType": "text/html; charset=utf-8",
      "bytes": 183421,
      "createdAt": "2026-09-11T05:20:00.000Z",
      "featured": true,
      "sort": 10,
      "capabilities": {
        "network": true,
        "audio": false,
        "fullscreen": true,
        "pointerLock": false,
        "geolocation": false,
        "clipboard": false
      }
    }
  ]
}
```

## Content identity

Every demo gets:
- CKBFS Type ID
- cryptographic `contentHash`
- filename
- byte length

The content hash is distinct from CKBFS Adler32. Adler32 provides protocol integrity; the app hash provides stronger content identity.

## Replacement

To update a demo:
- publish new immutable HTML;
- create a new manifest revision pointing to it;
- optionally record `supersedes`.

Do not append to a demo merely to represent a normal version upgrade. Treat app/demo releases as immutable artifacts.

## Hiding/removal

Prefer item status:
- `active`
- `hidden`
- `archived`

Removing a demo from current catalog does not destroy old CKBFS data.

## Rollback

Every manifest may point to `previous`.

Rollback means:
- verify older manifest;
- issue a new registry transition pointing to it;
- increment registry revision again.

Never decrement the registry revision.
