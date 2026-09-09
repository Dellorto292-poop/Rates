import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collect } from './collect.mjs';
import { PROVIDERS, fetchProvider } from './providers.mjs';
import { historyStart } from './publication.mjs';
import { isoDate, shiftDate } from './model.mjs';
import { createHttpClient } from './http.mjs';

export async function collectHistory({ date, endDate = date, outputDir, now = () => new Date().toISOString(), fetchProviderImpl = fetchProvider, collectDay = collect, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onResult = () => {} }) {
  date = isoDate(date);
  endDate = isoDate(endDate);
  if (date > now().slice(0, 10)) throw new Error('Future dates are not supported');
  const startDate = historyStart(date);
  if (endDate < startDate || endDate > date) throw new Error('History end date must be within the archive window');
  const days = Math.round((Date.parse(date) - Date.parse(startDate)) / 86400000);
  const archives = new Map();
  // Range sources are downloaded once; failed range requests also stay failed for this run.
  async function fetchBank(id, day, client) {
    if (!['BOM', 'ECB', 'NBKR'].includes(id)) return fetchProviderImpl(id, day, client);
    if (!archives.has(id)) archives.set(id, fetchProviderImpl(id, date, client, { lookbackDays: days + 14 }));
    const archive = await archives.get(id);
    return { ...archive, observations: archive.observations.filter(row => row.date <= day && row.date >= shiftDate(day, -14)) };
  }
  let failed = false;
  for (let day = endDate; day >= startDate; day = shiftDate(day, -1)) {
    const missing = [];
    for (const id of Object.keys(PROVIDERS)) {
      try {
        const status = JSON.parse(await readFile(path.join(outputDir, 'status', id, day + '.json'), 'utf8'));
        const snapshot = JSON.parse(await readFile(path.join(outputDir, 'banks', id, day + '.json'), 'utf8'));
        if (status.ok && status.provider === id && status.requestedDate === day && snapshot.provider === id &&
            snapshot.requestedDate === day && snapshot.fetchedAt === status.fetchedAt && snapshot.rateDate === status.rateDate) continue;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      missing.push(id);
    }
    if (!missing.length) continue;
    const result = await collectDay({ date: day, providers: missing, outputDir, now, client: createHttpClient(), fetchBank,
      onResult: row => onResult({ requestedDate: day, ...row }) });
    if (result.results.some(row => !row.ok)) failed = true;
    await sleep(250);
  }
  return { startDate, endDate, ok: !failed };
}
