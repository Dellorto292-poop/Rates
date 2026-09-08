import { fileURLToPath } from 'node:url';
import { preparePublication } from './publication.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--date' || args[2] !== '--output') throw new Error('Usage: npm run prepare:public -- --date YYYY-MM-DD --output NEW_DIRECTORY');
console.log(JSON.stringify(await preparePublication({ date: args[1], outputDir: args[3], dataDir: fileURLToPath(new URL('../data/', import.meta.url)) }), null, 2));
