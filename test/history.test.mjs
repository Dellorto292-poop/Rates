import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { collectHistory } from '../src/history.mjs';

async function cleanup(dir) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
  assert.match(path.basename(dir), /^fx-history-test-/);
  await rm(dir, { recursive: true, force: true });
}
test('history resumes completed dates and shares bounded range responses across days', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'fx-history-test-'));
  const calls = [];
  const days = [];
  try {
    const saved = { provider: 'BOM', requestedDate: '2026-09-08', rateDate: '2026-09-08', fetchedAt: '2026-09-08T12:00:00Z', ok: true };
    for (const folder of ['status', 'banks']) {
      await mkdir(path.join(outputDir, folder, 'BOM'), { recursive: true });
      await writeFile(path.join(outputDir, folder, 'BOM', '2026-09-08.json'), JSON.stringify(saved));
    }
    await collectHistory({ date: '2026-09-08', outputDir, now: () => '2026-09-08T12:00:00Z', sleep: async () => {},
      fetchProviderImpl: async (id, date, _client, options) => {
        calls.push({ id, date, options });
        return { observations: [{ date: '2026-09-08' }, { date: '2026-09-07' }, { date: '2026-03-08' }] };
      },
      collectDay: async options => {
        days.push(options.date);
        if (options.date === '2026-09-08') assert.equal(options.providers.includes('BOM'), false);
        for (const id of options.providers.filter(id => ['BOM', 'ECB', 'NBKR'].includes(id))) {
          const result = await options.fetchBank(id, options.date, options.client);
          assert.ok(result.observations.every(row => row.date <= options.date));
        }
        return { results: [{ ok: true }] };
      }
    });
    assert.equal(days.length, 185);
    assert.equal(days.at(-1), '2026-03-08');
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.options.lookbackDays === 198));
  } finally { await cleanup(outputDir); }
});
test('failed archive download is not repeated hundreds of times in one history run', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'fx-history-test-'));
  let calls = 0;
  try {
    const result = await collectHistory({ date: '2026-09-08', outputDir, now: () => '2026-09-08', sleep: async () => {},
      fetchProviderImpl: async () => { calls++; throw new Error('Unavailable'); },
      collectDay: async options => {
        await assert.rejects(options.fetchBank('BOM', options.date, options.client));
        return { results: [{ ok: false }] };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  } finally { await cleanup(outputDir); }
});
