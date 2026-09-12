import * as ccc from '@ckb-ccc/core';
import { ADMIN_PANEL_LOCK_HASHES } from '../../config/admin';
import { JUKEBOX_CONFIG } from '../../config/jukebox';
import { assertPudge } from '../ckbfs/client';
import { invariant } from '../ckbfs/errors';
import { findRegistry } from '../registry/registry';
export async function authorizeService(signer: ccc.Signer, additionalLocks = ADMIN_PANEL_LOCK_HASHES) {
  invariant(signer.signType === ccc.SignerSignType.JoyId, 'UNSUPPORTED_WALLET', 'Connect a JoyID wallet to open the service panel.');
  await assertPudge(signer.client);
  invariant(JUKEBOX_CONFIG.registryTypeId, 'MISSING_REGISTRY', 'Configure the verified registry Type ID before enabling service access.');
  const registry = await findRegistry(JUKEBOX_CONFIG.registryTypeId, signer.client);
  const lock = (await signer.getRecommendedAddressObj()).script;
  const owner = lock.eq(registry.cell.cellOutput.lock);
  invariant(owner || additionalLocks.includes(lock.hash()), 'ADMIN_ACCESS_DENIED', 'This JoyID lock is not authorized for the service panel. Connect an approved Pudge account.');
  return { lockHash: lock.hash(), owner };
}
