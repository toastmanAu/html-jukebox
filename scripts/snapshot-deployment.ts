import { writeFile } from 'node:fs/promises';
import { hexFrom } from '@ckb-ccc/core';
import { createPudgeClient, committedTransaction } from '../src/ckbfs/client';
import deployment from '../evidence/pudge-deployment.json';
const client = createPudgeClient();
const hashes = [deployment.depGroupTxHash, ...deployment.codeCells.map(c => c.txHash)];
const transactions: Record<string, string> = {};
for (const hash of hashes) transactions[hash] = hexFrom((await committedTransaction(client, hash as `0x${string}`)).toBytes());
await writeFile('tests/deployment.fixture.json', JSON.stringify(transactions, null, 2) + '\n');
