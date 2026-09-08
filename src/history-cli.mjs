import { fileURLToPath } from 'node:url';
import { collectHistory } from './history.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--date') throw new Error('Usage: npm run collect:history -- --date YYYY-MM-DD');
const outputDir = fileURLToPath(new URL('../data/', import.meta.url));
const result = await collectHistory({ date: args[1], outputDir, onResult: row => console.log(JSON.stringify(row)) });
if (!result.ok) process.exitCode = 1;
