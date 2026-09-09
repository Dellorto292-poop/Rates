import { update } from './update.mjs';
import { appendFile } from 'node:fs/promises';

const date = new Date().toISOString().slice(0, 10);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'date=' + date + '\n');
const result = await update({
  date,
  outputDir: process.env.RATES_DATA_DIR || 'data',
  backfill: process.env.RATES_BACKFILL === 'true',
  onResult: row => console.log(JSON.stringify(row))
});
if (!result.ok) process.exitCode = 1;
