# Research Source Notes

Research locked on 2026-09-11.

## CKBFS protocol

Upstream protocol:
https://github.com/code-monad/ckbfs

V3 RFC:
https://github.com/code-monad/ckbfs/blob/master/RFC.v3.md

Important V3 rules verified from RFC:
- metadata has one starting witness `index`;
- head witness version byte is `0x03`;
- head contains previous transaction position/checksum;
- witnesses link through `nextIndex`;
- V3 moves backlinks from cell data into witnesses.

## CKBFS API/deployment constants

Repository:
https://github.com/code-monad/ckbfs-api

Constants:
https://github.com/code-monad/ckbfs-api/blob/master/src/utils/constants.ts

Observed source declares:
- V3 = `20250821.4ee6689bf7ec`;
- V3 is default;
- exact mainnet/testnet code hashes, Type IDs, dep groups, deploy txs.

npm:
https://www.npmjs.com/package/@ckbfs/api

Observed npm version on 2026-09-11:
`2.0.19`

Observed GitHub master package.json during research:
`2.0.9`

Do not infer protocol version from package semver.

## CCC

Repository:
https://github.com/ckb-devrel/ccc

npm core:
https://www.npmjs.com/package/@ckb-ccc/core

Observed on 2026-09-11:
`@ckb-ccc/core 1.19.1`

npm React connector:
https://www.npmjs.com/package/@ckb-ccc/connector-react

Observed:
`@ckb-ccc/connector-react 1.1.9`

## CKB Type ID

RFC:
https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md

Genesis script list:
https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0024-ckb-genesis-script-list/0024-ckb-genesis-script-list.md

Verified built-in Type ID:
- code hash `0x00000000000000000000000000000000000000000000000000545950455f4944`
- hash type `type`
- no cell dep required.

## Owner reference repositories

https://github.com/toastmanAu/ckbfs-browser
https://github.com/toastmanAu/ckbfs-viewer

Use these for:
- existing implementation intent;
- browser transaction construction;
- display patterns.

Do not copy the existing resolver unchanged.
