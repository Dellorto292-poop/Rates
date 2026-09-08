import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { PROVIDERS } from './providers.mjs';

const args = process.argv.slice(2);
const options = { date: new Date().toISOString().slice(0, 10), outputDir: fileURLToPath(new URL('../data/', import.meta.url)), providers: Object.keys(PROVIDERS) };
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--date', '--providers', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: npm run collect -- --date YYYY-MM-DD [--providers BOM,ECB] [--output directory]');
    if (args[i] === '--date') options.date = args[i + 1];
    if (args[i] === '--providers') options.providers = args[i + 1].split(',');
    if (args[i] === '--output') options.outputDir = path.resolve(args[i + 1]);
  }
  const report = await collect({ ...options, onResult: row => console.log(JSON.stringify(row)) });
  if (report.results.some(row => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Collector lock exists. Check for a running process before removing the lock.' : error.message);
  process.exitCode = 1;
}
