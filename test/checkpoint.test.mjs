import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cleanSnapshot, cleanStatus } from '../src/state-contract.mjs';
import { readCheckpoint, persistState } from '../src/persist-state.mjs';
import { prepareCheckpoint } from '../src/checkpoint.mjs';

const date = '2026-09-08';
const snapshot = { schemaVersion: 1, provider: 'BOM', requestedDate: date, rateDate: date, fetchedAt: date + 'T12:00:01Z', base: 'USD', rates: { USD: 1, MNT: 3595.64, EUR: 0.86 }, personal: 'must not be copied' };
const status = { schemaVersion: 1, provider: 'BOM', requestedDate: date, rateDate: date, fetchedAt: snapshot.fetchedAt, attemptedAt: date + 'T12:00:00Z', ok: true, arbitrary: '<script>' };
async function cleanup(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.match(path.basename(root), /^rates-checkpoint-test-/);
  await rm(root, { recursive: true, force: true });
}
async function record(root, folder, value) {
  await mkdir(path.join(root, folder, 'BOM'), { recursive: true });
  await writeFile(path.join(root, folder, 'BOM', date + '.json'), JSON.stringify(value));
}
test('checkpoint field allowlists remove arbitrary content and reject bad numeric identities', () => {
  assert.equal(cleanSnapshot(snapshot, 'BOM', date).personal, undefined);
  assert.equal(cleanStatus(status, 'BOM', date).arbitrary, undefined);
  assert.throws(() => cleanSnapshot({ ...snapshot, rates: { USD: 1, MNT: 'bad', EUR: 1 } }, 'BOM', date));
  assert.throws(() => cleanSnapshot(snapshot, 'CBR', date));
  assert.throws(() => cleanStatus({ ...status, attemptedAt: 'bad' }, 'BOM', date));
});
test('checkpoint export preserves failed state and former snapshot separately', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rates-checkpoint-test-'));
  try {
    const source = path.join(root, 'input');
    await record(source, 'banks', snapshot);
    await record(source, 'status', { ...status, ok: false });
    await prepareCheckpoint({ date, dataDir: source, outputDir: path.join(root, 'output') });
    const files = await readCheckpoint(path.join(root, 'output'));
    assert.equal(JSON.parse(files.get('status/BOM/' + date + '.json')).ok, false);
    assert.equal(JSON.parse(files.get('banks/BOM/' + date + '.json')).rates.MNT, 3595.64);
    assert.equal([...files.values()].join('').includes('must not be copied'), false);
  } finally { await cleanup(root); }
});
test('unexpected artifacts and torn success state cannot reach the write job', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rates-checkpoint-test-'));
  try {
    await record(root, 'banks', snapshot);
    await record(root, 'status', { ...status, fetchedAt: date + 'T12:01:00Z' });
    await assert.rejects(readCheckpoint(root), /Torn checkpoint/);
    await record(root, 'status', status);
    assert.equal((await readCheckpoint(root)).size, 2);
    await writeFile(path.join(root, 'execute.mjs'), 'throw new Error("Never run");');
    await assert.rejects(readCheckpoint(root), /Unexpected checkpoint folder/);
  } finally { await cleanup(root); }
});
test('persist rejects a non-repository before any removal or writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rates-checkpoint-test-'));
  try {
    await writeFile(path.join(root, 'keep.txt'), 'keep');
    await assert.rejects(persistState(root, root));
    assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  } finally { await cleanup(root); }
});
