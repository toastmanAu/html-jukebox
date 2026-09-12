import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ccc from '@ckb-ccc/core';
import { PUDGE_GENESIS } from '../src/ckbfs/client';
import { ADMIN_PANEL_ACCOUNTS } from '../config/admin';
import { createPudgeClient } from '../src/ckbfs/client';
import { authorizeService } from '../src/admin/access';
const owner = ccc.Script.from({codeHash:'0x'+'11'.repeat(32),hashType:'type',args:'0x1234'});
const other = ccc.Script.from({...owner,args:'0xabcd'});
vi.mock('../src/registry/registry',()=>({findRegistry:vi.fn()}));
import { findRegistry } from '../src/registry/registry';
function signer(lock=owner, prefix='ckt', genesis=PUDGE_GENESIS) { return {signType:ccc.SignerSignType.JoyId,client:{addressPrefix:prefix,getHeaderByNumberNoCache:async()=>({hash:genesis})},getRecommendedAddressObj:async()=>({script:lock})} as unknown as ccc.Signer; }
beforeEach(()=>{vi.mocked(findRegistry).mockResolvedValue({cell:{cellOutput:{lock:owner}}} as never);});
describe('service access',()=>{
 it.each(ADMIN_PANEL_ACCOUNTS)('authorizes configured Pudge address $address',async account=>{const decoded=await ccc.Address.fromString(account.address,createPudgeClient());expect(decoded.script.hash()).toBe(account.lockHash);expect((await authorizeService(signer(decoded.script))).lockHash).toBe(account.lockHash);});
 it('allows the live registry owner',async()=>{expect((await authorizeService(signer())).owner).toBe(true);});
 it('rejects an unlisted lock',async()=>{await expect(authorizeService(signer(other))).rejects.toThrow('ADMIN_ACCESS_DENIED');});
 it('admits an explicitly listed panel admin without calling it the owner',async()=>{expect(await authorizeService(signer(other),[other.hash()])).toEqual({owner:false,lockHash:other.hash()});});
 it('rejects mainnet even for an approved lock',async()=>{await expect(authorizeService(signer(owner,'ckb'))).rejects.toThrow('WRONG_NETWORK');});
 it('rejects a wrong genesis even with a testnet prefix',async()=>{await expect(authorizeService(signer(owner,'ckt','0x'+'00'.repeat(32)))).rejects.toThrow('WRONG_NETWORK');});
 it('fails closed when the registry cannot be verified',async()=>{vi.mocked(findRegistry).mockRejectedValueOnce(Error('MISSING_REGISTRY'));await expect(authorizeService(signer())).rejects.toThrow('MISSING_REGISTRY');});
 it('requires JoyID rather than an arbitrary signer',async()=>{const s=signer();Object.defineProperty(s,'signType',{value:'other'});await expect(authorizeService(s)).rejects.toThrow('UNSUPPORTED_WALLET');});
});
