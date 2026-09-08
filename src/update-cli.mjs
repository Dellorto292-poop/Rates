import { collect } from './collect.mjs';
import { collectHistory } from './history.mjs';
import { shiftDate } from './model.mjs';
import { appendFile } from 'node:fs/promises';

const date = new Date().toISOString().slice(0, 10);
const outputDir = process.env.RATES_DATA_DIR || 'data';
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'date=' + date + '\n');
let ok = true;
if (process.env.RATES_BACKFILL === 'true') {
  ok = (await collectHistory({ date, outputDir, onResult: row => console.log(JSON.stringify(row)) })).ok;
}
// Recheck recent dates to include publications released after the last UTC run.
for (let offset = 2; offset >= 0; offset--) {
  const report = await collect({ date: shiftDate(date, -offset), outputDir, onResult: row => console.log(JSON.stringify(row)) });
  if (report.results.some(row => !row.ok)) ok = false;
}
if (!ok) process.exitCode = 1;
