import { collect } from './collect.mjs';
import { collectHistory } from './history.mjs';
import { shiftDate } from './model.mjs';
import { appendFile } from 'node:fs/promises';

const date = new Date().toISOString().slice(0, 10);
const outputDir = process.env.RATES_DATA_DIR || 'data';
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'date=' + date + '\n');
// Repair unavailable archive dates on every run, including failures that aged
// out of the recent-date recheck window. Successful snapshots are skipped.
let ok = (await collectHistory({
  date,
  endDate: process.env.RATES_BACKFILL === 'true' ? date : shiftDate(date, -3),
  outputDir,
  onResult: row => console.log(JSON.stringify(row))
})).ok;
// Recheck recent dates to include publications released after the last UTC run.
for (let offset = 2; offset >= 0; offset--) {
  const requestedDate = shiftDate(date, -offset);
  const report = await collect({ date: requestedDate, outputDir, onResult: row => console.log(JSON.stringify({ requestedDate, ...row })) });
  if (report.results.some(row => !row.ok)) ok = false;
}
if (!ok) process.exitCode = 1;
