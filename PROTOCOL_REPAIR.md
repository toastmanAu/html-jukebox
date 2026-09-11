# CKBFS V3 Browser Module — Repair Specification

## Why

The existing browser package has a V3 publisher but a resolver that still assumes V2 discovery and does not fully reconstruct V3 witness links.

Create one canonical, browser-native V3 implementation with symmetric write/read tests.

## V3 metadata

Molecule table:

```text
CKBFSData {
  index: Uint32,
  checksum: Uint32,
  content_type: Bytes,
  filename: Bytes,
}
```

`index` points to the first witness of the latest segment.

## Head witness layout

```text
0..4    ASCII "CKBFS"
5       0x03
6..37   previous transaction hash (32 bytes)
38..41  previous witness index (u32 LE)
42..45  previous checksum (u32 LE)
46..49  next witness index (u32 LE)
50..    content
```

Continuation witness:

```text
0..3    next witness index (u32 LE)
4..     content
```

Tail:
`next witness index = 0`.

## Resolver algorithm

1. Parse identifier.
2. Locate exact live V3 CKBFS cell.
3. Decode V3 Molecule metadata.
4. Fetch transaction that created current live state.
5. Start from metadata `index`.
6. Parse V3 head.
7. Follow `nextIndex` until zero.
8. Detect loops, repeats, out-of-range indexes, unreasonable chunk counts.
9. Collect bytes for current segment.
10. If `previousTxHash != zero`, follow previous transaction + previous head index.
11. Repeat backward with a sane depth cap.
12. Order history oldest -> newest.
13. Concatenate bytes.
14. Validate cumulative Adler32 against current metadata.
15. Return bytes + metadata + provenance.

## Suggested return

```ts
type ResolvedCKBFSFile = {
  protocol: "20250821.4ee6689bf7ec";
  network: "testnet";
  typeId: string;
  filename: string;
  contentType: string;
  fileBytes: Uint8Array;
  size: number;
  checksum: number;
  checksumValid: boolean;
  currentOutPoint: { txHash: string; index: string };
  history: Array<{
    txHash: string;
    headWitnessIndex: number;
    chunkCount: number;
    byteLength: number;
  }>;
};
```

## Publisher

Must:
- use locked V3 code hash with `data1`;
- add locked testnet V3 dep group;
- encode V3 Molecule;
- collect signer inputs before final witness indexing;
- reserve one lock-witness slot per input;
- place CKBFS witnesses after input witnesses;
- compute Type ID from first input + output index;
- calculate fee from the final witness-bearing tx;
- return Type ID, tx hash, outpoint, capacity and chunk/byte counts.

## Append / large files

Do not decide safety only from source file byte length.

Build/serialize the transaction and compare against a conservative configured maximum.

If content will not fit:
- preferred: publish first segment and append subsequent segments using V3 backlinks;
- interim fallback: reject before first signature with a precise reason.

Never split one logical demo into unrelated CKBFS Type IDs simply to bypass size limits.

## Browser-only runtime

No Node-only:
- `fs`
- `crypto`
- Buffer assumptions

Use:
- `Uint8Array`
- `TextEncoder`
- `TextDecoder`
- Web APIs
- CCC

## Fixtures/tests

Required:
- empty file
- one witness
- two-witness file
- many-witness file
- one append
- multiple appends
- invalid magic
- wrong version
- malformed next index
- witness loop
- checksum mismatch
- V2 cell passed to V3 decoder

Optional V2 support belongs in a separate module.
