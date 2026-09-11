import { writeFile } from 'node:fs/promises';
import { hashCkb, Script } from '@ckb-ccc/core';
import { createPudgeClient } from '../src/ckbfs/client';
import { resolveV3 } from '../src/ckbfs/resolver';
import { CKBFS_V3_TESTNET as V3 } from '../config/ckbfs-v3';
const client = createPudgeClient();
const page = await client.findCellsPagedNoCache({ script: Script.from({ codeHash: V3.codeHash, hashType: 'data1', args: '0x' }), scriptType: 'type', scriptSearchMode: 'prefix', withData: true }, 'desc', 5);
const evidence = [];
for (const cell of page.cells) {
  const typeId = cell.cellOutput.type!.args;
  try {
    const result = await resolveV3(typeId, { client, maxBytes: 4 * 1024 * 1024 });
    const { fileBytes, ...metadata } = result;
    evidence.push({ ...metadata, contentHash: hashCkb(fileBytes), checkedAt: new Date().toISOString() });
    console.log(result.typeId, result.filename, result.size, result.history);
  } catch (error) { console.error(typeId, String(error)); }
}
await writeFile('evidence/pudge-existing-files.json', JSON.stringify(evidence, null, 2) + '\n');
if (!evidence.length) process.exitCode = 1;
