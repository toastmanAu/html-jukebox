import * as ccc from '@ckb-ccc/core';
import { CKBFS_V3_TESTNET as V3 } from '../../config/ckbfs-v3';
import { readU32 } from './codec';
import { assertPudge, committedTransaction, type ChainClient } from './client';
import { invariant } from './errors';
export interface DeploymentVerification {
  verified: true; network: 'testnet'; protocol: typeof V3.protocol; checkedAt: string;
  depGroupTxHash: string; codeCells: { txHash: string; index: number; dataHash: string; typeHash?: string }[];
}
export async function verifyV3Deployment(client: ChainClient): Promise<DeploymentVerification> {
  await assertPudge(client);
  const tx = await committedTransaction(client, V3.depGroupTxHash);
  invariant(tx.outputs[0] && tx.outputsData[0], 'DEPLOYMENT_MISMATCH', 'Pinned dep-group output 0 is missing.');
  const live = await client.getCellLiveNoCache({ txHash: V3.depGroupTxHash, index: 0 }, true);
  invariant(live, 'DEPLOYMENT_MISMATCH', 'Pinned dep-group output 0 is not live. Do not publish.');
  const data = ccc.bytesFrom(tx.outputsData[0]);
  const count = readU32(data);
  invariant(count > 0 && count <= 16 && data.length === 4 + count * 36,
    'DEPLOYMENT_MISMATCH', 'Malformed dep-group OutPointVec.');
  const codeCells: DeploymentVerification['codeCells'] = [];
  for (let i = 0; i < count; i++) {
    const pos = 4 + i * 36;
    const txHash = ccc.hexFrom(data.slice(pos, pos + 32)), index = readU32(data, pos + 32);
    const codeTx = await committedTransaction(client, txHash);
    invariant(codeTx.outputs[index] && codeTx.outputsData[index], 'DEPLOYMENT_MISMATCH', 'Referenced code output is missing.');
    invariant(await client.getCellLiveNoCache({ txHash, index }, true), 'DEPLOYMENT_MISMATCH', 'Referenced code cell is spent.');
    codeCells.push({ txHash, index, dataHash: ccc.hashCkb(codeTx.outputsData[index]), typeHash: codeTx.outputs[index].type?.hash() });
  }
  invariant(codeCells.some(c => c.dataHash === V3.codeHash && c.typeHash === V3.typeId && c.txHash === V3.deployTxHash),
    'DEPLOYMENT_MISMATCH', 'Pinned V3 code bytes, Type ID or deployment transaction do not match. Do not substitute another contract.');
  invariant(codeCells.some(c => c.dataHash === V3.adler32CodeHash && c.typeHash === V3.adler32TypeId),
    'DEPLOYMENT_MISMATCH', 'Pinned Adler32 code bytes or Type ID do not match the dep group.');
  return { verified: true, network: 'testnet', protocol: V3.protocol, depGroupTxHash: V3.depGroupTxHash, checkedAt: new Date().toISOString(), codeCells };
}
