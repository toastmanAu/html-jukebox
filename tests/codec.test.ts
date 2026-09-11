import { describe, expect, it } from 'vitest';
import { bytesFrom, hexFrom } from '@ckb-ccc/core';
import { adler32, decodeHead, decodeMetadata, encodeHead, encodeMetadata, u32, utf8, ZERO_HASH } from '../src/ckbfs/codec';
import { parseCKBFSIdentifier } from '../src/ckbfs/identifier';
import { CKBFS_PROTOCOL_V3, CKBFS_V3_TESTNET } from '../config/ckbfs-v3';
describe('locked V3 byte codecs', () => {
  it('pins every deployment constant', () => {
    expect(CKBFS_PROTOCOL_V3).toBe('20250821.4ee6689bf7ec');
    expect(CKBFS_V3_TESTNET).toEqual({ protocol: '20250821.4ee6689bf7ec', codeHash: '0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695', typeId: '0xaebf5a7b541da9603c2066a9768d3d18fea2e7f3c1943821611545155fecc671', depGroupTxHash: '0x47cfa8d554cccffe7796f93b58437269de1f98f029d0a52b6b146381f3e95e61', depGroupIndex: '0x0', depType: 'depGroup', deployTxHash: '0x1488b592b0946589730c906c6d9a46fb82c1181156fc1a4251adce14002a9cfb', adler32CodeHash: '0xbd944c8c5aa127270b591d50ab899c9a2a3e4429300db4ea3d7523aa592c1db1', adler32TypeId: '0x552e2a5e679f45bca7834b03a1f8613f2a910b64a7bafb51986cfc6f1b6cb31c' });
  });
  it('matches independently laid out Molecule bytes', () => {
    const golden = '0x2600000014000000180000001c00000021000000010000000100000001000000610100000062';
    const metadata = { index: 1, checksum: 1, contentType: 'a', filename: 'b' };
    expect(hexFrom(encodeMetadata(metadata))).toBe(golden);
    expect(decodeMetadata(bytesFrom(golden))).toEqual(metadata);
  });
  it('matches the published Adler32 test vector', () => {
    expect(adler32(utf8.encode('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(new Uint8Array())).toBe(1);
    expect(adler32(utf8.encode('pedia'), adler32(utf8.encode('Wiki')))).toBe(0x11e60398);
  });
  it('matches head field offsets', () => {
    const raw = new Uint8Array(bytesFrom(`0x434b42465303${'00'.repeat(32)}0000000000000000020000006162`));
    expect(decodeHead(raw)).toEqual({ previousTxHash: ZERO_HASH, previousWitnessIndex: 0, previousChecksum: 0, nextIndex: 2, content: utf8.encode('ab') });
    expect(encodeHead(utf8.encode('ab'), 2)).toEqual(raw);
  });
  it.each([-1, 1.5, 2 ** 32, NaN])('rejects invalid Uint32 %s', value => expect(() => u32(value)).toThrow('INVALID_U32'));
  it('rejects V2 and malformed tables', () => {
    const bytes = encodeMetadata({ index: 1, checksum: 1, contentType: '', filename: '' });
    bytes.set(u32(24), 4); expect(() => decodeMetadata(bytes)).toThrow('INVALID_METADATA');
    expect(() => decodeMetadata(new Uint8Array(2))).toThrow();
  });
  it('rejects invalid Bytes lengths and UTF-8', () => {
    const bytes = encodeMetadata({ index: 1, checksum: 1, contentType: 'a', filename: 'b' });
    bytes[32] = 255; expect(() => decodeMetadata(bytes)).toThrow('UTF-8');
    bytes.set(u32(80), 28); expect(() => decodeMetadata(bytes)).toThrow('length mismatch');
  });
});
describe('unambiguous identifiers', () => {
  it('parses type IDs and explicit outpoints', () => {
    expect(parseCKBFSIdentifier(`ckbfs://testnet/${ZERO_HASH}`)).toEqual({ kind: 'typeId', typeId: ZERO_HASH });
    expect(parseCKBFSIdentifier(`${ZERO_HASH}:0x2`)).toEqual({ kind: 'outPoint', txHash: ZERO_HASH, index: 2 });
  });
  it.each(['abc', 'ckbfs://mainnet/' + ZERO_HASH, ZERO_HASH + ':4294967296', ZERO_HASH + ':-1', ZERO_HASH + '?x=1'])('rejects %s', text => expect(() => parseCKBFSIdentifier(text)).toThrow('INVALID_IDENTIFIER'));
});
