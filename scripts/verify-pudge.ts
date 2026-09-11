import { writeFile } from 'node:fs/promises';
import { createPudgeClient } from '../src/ckbfs/client';
import { verifyV3Deployment } from '../src/ckbfs/deployment';
try {
  const proof = await verifyV3Deployment(createPudgeClient(process.env.PUDGE_RPC));
  await writeFile('evidence/pudge-deployment.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
