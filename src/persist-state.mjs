import { readdir, lstat, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BANK_CURRENCIES, cleanSnapshot, cleanStatus, day } from './state-contract.mjs';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error('Git operation failed: ' + args[0]);
  return result.stdout.trim();
}
export async function readCheckpoint(root) {
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Linked checkpoint root');
  const files = new Map();
  for (const folder of await readdir(root, { withFileTypes: true })) {
    if (!['banks', 'status'].includes(folder.name) || !folder.isDirectory() || folder.isSymbolicLink()) throw new Error('Unexpected checkpoint folder');
    for (const bank of await readdir(path.join(root, folder.name), { withFileTypes: true })) {
      if (!Object.hasOwn(BANK_CURRENCIES, bank.name) || !bank.isDirectory() || bank.isSymbolicLink()) throw new Error('Unexpected bank folder');
      for (const entry of await readdir(path.join(root, folder.name, bank.name), { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^(?:\d{4}-\d{2}-\d{2}|latest)\.json$/.test(entry.name) || folder.name === 'status' && entry.name === 'latest.json') throw new Error('Unexpected checkpoint file');
        const relative = [folder.name, bank.name, entry.name].join('/');
        const file = path.join(root, relative);
        if ((await lstat(file)).size > 32768) throw new Error('Oversized checkpoint');
        const raw = JSON.parse(await readFile(file, 'utf8'));
        const date = entry.name === 'latest.json' ? day(raw.requestedDate) : day(entry.name.slice(0, 10));
        const clean = folder.name === 'banks' ? cleanSnapshot(raw, bank.name, date) : cleanStatus(raw, bank.name, date);
        files.set(relative, JSON.stringify(clean, null, 2) + '\n');
      }
    }
  }
  if (!files.size) throw new Error('Empty checkpoint cannot replace saved history');
  for (const [name, value] of files) {
    if (!name.startsWith('status/')) continue;
    const status = JSON.parse(value);
    if (!status.ok) continue;
    const snapshot = JSON.parse(files.get(name.replace(/^status\//, 'banks/')) || 'null');
    if (!snapshot || snapshot.fetchedAt !== status.fetchedAt || snapshot.rateDate !== status.rateDate) throw new Error('Torn checkpoint');
  }
  return files;
}

export async function persistState(source, target) {
  const root = await realpath(target);
  if (await realpath(git(root, ['rev-parse', '--show-toplevel'])) !== root || git(root, ['branch', '--show-current']) !== 'codex/rates-data') throw new Error('Expected dedicated data checkout');
  const files = await readCheckpoint(source);
  // Only these two verified data directories may be removed from the dedicated branch.
  for (const folder of ['banks', 'status']) {
    const resolved = path.resolve(root, folder);
    if (path.dirname(resolved) !== root) throw new Error('Unsafe checkpoint destination');
    try { if ((await lstat(resolved)).isSymbolicLink()) throw new Error('Linked checkpoint destination'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  git(root, ['rm', '-r', '--ignore-unmatch', '--', 'banks', 'status']);
  for (const [name, contents] of files) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) throw new Error('Unsafe checkpoint path');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  git(root, ['add', '--', 'banks', 'status']);
  if (!git(root, ['diff', '--cached', '--name-only'])) return false;
  git(root, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Update validated central bank history']);
  git(root, ['push', 'origin', 'HEAD:refs/heads/codex/rates-data']);
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node src/persist-state.mjs CHECKPOINT DATA_CHECKOUT');
  console.log(await persistState(process.argv[2], process.argv[3]) ? 'Checkpoint committed' : 'Checkpoint unchanged');
}
