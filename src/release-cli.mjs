import { preparePublication } from './publication.mjs';
import { prepareCheckpoint } from './checkpoint.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--date') throw new Error('Usage: npm run release -- --date YYYY-MM-DD');
const dataDir = process.env.RATES_DATA_DIR || 'data';
console.log(JSON.stringify(await preparePublication({ date: args[1], dataDir, outputDir: 'public' })));
console.log(JSON.stringify(await prepareCheckpoint({ date: args[1], dataDir, outputDir: 'checkpoint' })));
