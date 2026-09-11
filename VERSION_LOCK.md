# Version Lock

This file is authoritative for the initial build.

## Independent version domains

| Domain | Locked initial value |
|---|---|
| CKBFS protocol | `20250821.4ee6689bf7ec` (V3) |
| App registry schema | `1` |
| App manifest schema | `1` |
| IndexedDB schema | `1` |
| `@ckb-ccc/core` | `1.19.1` |
| `@ckb-ccc/connector-react` | `1.1.9` |
| `@ckbfs/api` | reference implementation only; npm latest observed `2.0.19` |

The upstream `code-monad/ckbfs-api` GitHub `package.json` observed during research still reports `2.0.9`, while npm reports `2.0.19`. Treat that as package/repository drift. It does **not** change the CKBFS protocol identifier.

## Authoritative protocol identifier

```ts
export const CKBFS_PROTOCOL_V3 = "20250821.4ee6689bf7ec" as const;
```

Source of the protocol/deployment constants:
`code-monad/ckbfs-api/src/utils/constants.ts`

Observed upstream blob SHA:
`7c231e10d084c614a61a98eeaf5cca56dbe347db`

## Locked CKBFS V3 TESTNET deployment

```ts
export const CKBFS_V3_TESTNET = {
  protocol: "20250821.4ee6689bf7ec",

  codeHash:
    "0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695",

  typeId:
    "0xaebf5a7b541da9603c2066a9768d3d18fea2e7f3c1943821611545155fecc671",

  depGroupTxHash:
    "0x47cfa8d554cccffe7796f93b58437269de1f98f029d0a52b6b146381f3e95e61",

  depGroupIndex: "0x0",
  depType: "depGroup",

  deployTxHash:
    "0x1488b592b0946589730c906c6d9a46fb82c1181156fc1a4251adce14002a9cfb",

  adler32CodeHash:
    "0xbd944c8c5aa127270b591d50ab899c9a2a3e4429300db4ea3d7523aa592c1db1",

  adler32TypeId:
    "0x552e2a5e679f45bca7834b03a1f8613f2a910b64a7bafb51986cfc6f1b6cb31c",

  adler32DeployTxHash:
    "0x8d6bd7ea704f9b19af5b83b81544c34982515a825e6185d88faf47583a542671",
} as const;
```

## Mainnet reference — disabled initially

```ts
export const CKBFS_V3_MAINNET = {
  protocol: "20250821.4ee6689bf7ec",
  codeHash:
    "0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695",
  typeId:
    "0xcc5411e8b70e551d7a3dd806256533cff6bc12118b48dd7b2d5d2292c3651add",
  depGroupTxHash:
    "0x03deba7f8206c81981d6f6a2d61b67dde75b4df91cbcfaf2e2fb041ba50c4719",
  depGroupIndex: "0x0",
  depType: "depGroup",
  deployTxHash:
    "0xd25f2c32f56c28c630d4f91955f1b3c9cd53e26fa0745d540d934e8e3d3c2853",
} as const;
```

Do not enable mainnet writes in the initial app.

## Built-in CKB Type ID

This is used for the Jukebox Registry singleton and is separate from the CKBFS type script.

```ts
export const BUILTIN_TYPE_ID = {
  codeHash:
    "0x00000000000000000000000000000000000000000000000000545950455f4944",
  hashType: "type",
} as const;
```

No cell dep is required because Type ID is built into CKB.

Creation args:

```ts
const args = ccc.hashTypeId(tx.inputs[0], registryOutputIndex);
```

## Existing repo drift to repair

### `toastmanAu/ckbfs-browser`

Useful:
- browser-native CCC transaction construction;
- V3 publisher direction;
- V3 constants.

Incorrect/stale for this build:
- README/package description still say V2;
- resolver queries V2 code hash;
- V3 multi-witness `nextIndex` chain is not reconstructed;
- cross-transaction V3 backlinks are not reconstructed;
- read/write behavior is not symmetric.

### `toastmanAu/ckbfs-viewer`

Useful:
- Blob rendering lifecycle;
- browser-side resolution/display patterns.

Problem:
- uses the same V2-oriented resolver assumptions.

## Dependency policy

Pin exact chain-critical versions initially:

```json
{
  "@ckb-ccc/core": "1.19.1",
  "@ckb-ccc/connector-react": "1.1.9"
}
```

Commit the package lockfile.

Do not use caret/tilde ranges for these packages until the test suite exists.

## Required deployment preflight

Implement:

```ts
verifyV3Deployment(client): Promise<DeploymentVerification>
```

It must:
1. fetch the pinned testnet V3 dep-group transaction;
2. confirm it is available/committed;
3. confirm output index `0`;
4. decode dep-group outpoints;
5. retrieve the referenced code cell(s);
6. verify the expected V3 code hash;
7. fail loudly in dev/admin mode if constants do not match.

Never silently swap to another contract version.

## Version lock acceptance tests

Versioning is not considered solved until tests prove:

- V3 constants equal the pinned fixture;
- testnet deployment preflight passes;
- single-witness V3 resolves exactly;
- multi-witness V3 resolves exactly;
- appended/multi-transaction V3 resolves exactly;
- browser-published bytes resolve byte-for-byte;
- V2 constants never enter the V3 write path;
- legacy V2 reads, if implemented, are explicit and separate.
