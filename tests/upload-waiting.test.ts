import * as ccc from '@ckb-ccc/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveUploadedFile } from '../src/admin/resolve-upload';
import { resolveV3 } from '../src/ckbfs/resolver';
import { CKBFSError } from '../src/ckbfs/errors';
import { chainFixture, typeId } from './fixtures';
vi.mock('../src/ckbfs/resolver',()=>({resolveV3:vi.fn()}));
const f=chainFixture([new Uint8Array([1,2,3])]);const receipt={typeId,txHash:f.transactions[0].hash()};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(resolveV3).mockRejectedValue(new CKBFSError('MISSING_CKBFS','not indexed'));});
describe('uploaded file waiting diagnostics',()=>{
 it('does not resolve the old live prefix while the append is pending',async()=>{const c={...f.client,getTransactionNoCache:vi.fn(async()=>ccc.ClientTransactionResponse.from({transaction:f.transactions[0],status:'pending'}))};await expect(resolveUploadedFile(receipt,c)).rejects.toThrow('TRANSACTION_NOT_COMMITTED');expect(resolveV3).not.toHaveBeenCalled();});
 it('reports committed live cells awaiting indexer sync',async()=>{await expect(resolveUploadedFile(receipt,f.client)).rejects.toThrow('INDEXER_SYNC_PENDING');});
 it('directs an unavailable broadcast to recovery, never a fresh upload',async()=>{await expect(resolveUploadedFile(receipt,{...f.client,getTransactionNoCache:vi.fn(async()=>undefined)})).rejects.toThrow('Recover known transaction');});
 it('does not mask integrity errors with a waiting message',async()=>{vi.mocked(resolveV3).mockRejectedValue(new CKBFSError('CHECKSUM_MISMATCH','corrupt'));const get=vi.fn(f.client.getTransactionNoCache);await expect(resolveUploadedFile(receipt,{...f.client,getTransactionNoCache:get})).rejects.toThrow('CHECKSUM_MISMATCH');expect(get).toHaveBeenCalled();});
 it('keeps missing-file diagnostics when the committed output is no longer live',async()=>{await expect(resolveUploadedFile(receipt,{...f.client,getCellLiveNoCache:vi.fn(async()=>undefined)})).rejects.toThrow('MISSING_CKBFS');});
 it('reports stale discovery separately from byte corruption when the expected head is live',async()=>{
   vi.mocked(resolveV3).mockResolvedValue({currentOutPoint:{txHash:'0x'+'99'.repeat(32)},fileBytes:new Uint8Array([1])} as never);
   await expect(resolveUploadedFile(receipt,f.client)).rejects.toThrow('INDEXER_SYNC_PENDING');
 });
 it('rejects a superseding head rather than accepting unrelated bytes',async()=>{
   vi.mocked(resolveV3).mockResolvedValue({currentOutPoint:{txHash:'0x'+'99'.repeat(32)},fileBytes:new Uint8Array([1])} as never);
   await expect(resolveUploadedFile(receipt,{...f.client,getCellLiveNoCache:vi.fn(async()=>undefined)})).rejects.toThrow('CELL_CHANGED');
 });
 it('returns bytes only for the confirmed expected head',async()=>{
   const result={currentOutPoint:{txHash:receipt.txHash},fileBytes:new Uint8Array([1,2,3])};vi.mocked(resolveV3).mockResolvedValue(result as never);
   expect(await resolveUploadedFile(receipt,f.client)).toBe(result);
 });

});
