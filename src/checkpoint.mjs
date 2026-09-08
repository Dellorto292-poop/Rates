import { mkdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './collect.mjs';
import { historyStart } from './publication.mjs';
import { shiftDate } from './model.mjs';
import { BANK_CURRENCIES, cleanSnapshot, cleanStatus, day } from './state-contract.mjs';

async function readRecord(root, kind, bank, date) {
  for (const entry of [root, path.join(root, kind), path.join(root, kind, bank), path.join(root, kind, bank, date + '.json')]) {
    try { if ((await lstat(entry)).isSymbolicLink()) throw new Error('Symbolic links are not allowed in checkpoint input'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const file = path.join(root, kind, bank, date + '.json');
  if ((await lstat(file)).size > 131072) throw new Error('Oversized checkpoint input');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function prepareCheckpoint({ date, dataDir, outputDir }) {
  day(date);
  const root = path.resolve(dataDir);
  const target = path.resolve(outputDir);
  if (root === target || !path.relative(root, target).startsWith('..') || !path.relative(target, root).startsWith('..')) throw new Error('Checkpoint directories must be separate');
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target);
  let count = 0;
  for (const bank of Object.keys(BANK_CURRENCIES)) {
    let latest;
    for (let dateKey = historyStart(date); dateKey <= date; dateKey = shiftDate(dateKey, 1)) {
      const rawStatus = await readRecord(root, 'status', bank, dateKey);
      const rawSnapshot = await readRecord(root, 'banks', bank, dateKey);
      const status = rawStatus ? cleanStatus(rawStatus, bank, dateKey) : null;
      const snapshot = rawSnapshot ? cleanSnapshot(rawSnapshot, bank, dateKey) : null;
      if (status?.ok && (!snapshot || status.fetchedAt !== snapshot.fetchedAt || status.rateDate !== snapshot.rateDate)) throw new Error('Torn checkpoint');
      if (snapshot) {
        await atomicJson(path.join(target, 'banks', bank, dateKey + '.json'), snapshot);
        if (!latest || snapshot.rateDate >= latest.rateDate) latest = snapshot;
        count++;
      }
      if (status) await atomicJson(path.join(target, 'status', bank, dateKey + '.json'), status);
    }
    if (latest) await atomicJson(path.join(target, 'banks', bank, 'latest.json'), latest);
  }
  return { count };
}
