export const CKBFS_PROTOCOL_V3 = "20250821.4ee6689bf7ec" as const;

export const CKBFS_V3_TESTNET = {
  protocol: CKBFS_PROTOCOL_V3,
  codeHash:
    "0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695",
  typeId:
    "0xaebf5a7b541da9603c2066a9768d3d18fea2e7f3c1943821611545155fecc671",
  depGroupTxHash:
    "0x47cfa8d554cccffe7796f93b58437269de1f98f029d0a52b6b146381f3e95e61",
  depGroupIndex: "0x0",
  depType: "depGroup" as const,
  deployTxHash:
    "0x1488b592b0946589730c906c6d9a46fb82c1181156fc1a4251adce14002a9cfb",
  adler32CodeHash:
    "0xbd944c8c5aa127270b591d50ab899c9a2a3e4429300db4ea3d7523aa592c1db1",
  adler32TypeId:
    "0x552e2a5e679f45bca7834b03a1f8613f2a910b64a7bafb51986cfc6f1b6cb31c",
} as const;

export const BUILTIN_TYPE_ID = {
  codeHash:
    "0x00000000000000000000000000000000000000000000000000545950455f4944",
  hashType: "type" as const,
} as const;
