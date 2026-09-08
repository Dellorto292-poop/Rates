import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RateError, isoDate, makeSnapshot } from './model.mjs';
import { PROVIDERS, fetchProvider } from './providers.mjs';
import { createHttpClient } from './http.mjs';

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function existing(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function collect({ date, providers = Object.keys(PROVIDERS), outputDir, client = createHttpClient(), fetchBank = fetchProvider, now = () => new Date().toISOString(), onResult = () => {} }) {
  date = isoDate(date);
  if (date > now().slice(0, 10)) throw new RateError('future-request', 'Cannot request a future date');
  if (!providers.length || new Set(providers).size !== providers.length || providers.some(id => !Object.hasOwn(PROVIDERS, id))) {
    throw new RateError('unsupported-provider', 'Provider list must contain unique supported bank codes');
  }
  const root = path.resolve(outputDir);
  await mkdir(root, { recursive: true });
  // Prevent overlapping runs from overwriting status/history out of order.
  const lock = path.join(root, '.collect.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: now() }), { flag: 'wx' });
  try {
    const results = [];
    for (const id of providers) {
      const attemptedAt = now();
      let result;
      try {
        const fetched = await fetchBank(id, date, client);
        const snapshot = makeSnapshot(PROVIDERS[id], date, fetched.observations, fetched.sources, now());
        snapshot.responses = fetched.responses;
        const file = path.join(root, 'banks', id, date + '.json');
        const previous = await existing(file);
        if (previous && previous.rateDate > snapshot.rateDate) throw new RateError('stale-response', 'Refusing to replace a newer publication with an older one');
        await atomicJson(file, snapshot);
        const latestFile = path.join(root, 'banks', id, 'latest.json');
        const latest = await existing(latestFile);
        if (!latest || latest.requestedDate <= date && latest.rateDate <= snapshot.rateDate) await atomicJson(latestFile, snapshot);
        result = { provider: id, ok: true, attemptedAt, fetchedAt: snapshot.fetchedAt, rateDate: snapshot.rateDate, quotes: Object.keys(snapshot.rates).length };
      } catch (error) {
        result = { provider: id, ok: false, attemptedAt, error: error.code || 'collection-error', message: error instanceof RateError ? error.message : 'Collection or local persistence failed' };
      }
      results.push(result);
      await atomicJson(path.join(root, 'status', id, date + '.json'), { schemaVersion: 1, requestedDate: date, ...result });
      onResult(result);
    }
    const report = { schemaVersion: 1, requestedDate: date, completedAt: now(), results };
    await atomicJson(path.join(root, 'runs', date + '.json'), report);
    return report;
  } finally {
    await unlink(lock);
  }
}
