import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './collect.mjs';
import { PROVIDERS } from './providers.mjs';
import { isoDate, shiftDate, RateError } from './model.mjs';

export function historyStart(date) {
  const parsed = new Date(isoDate(date) + 'T00:00:00Z');
  const day = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() - 6);
  const last = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  parsed.setUTCDate(Math.min(day, last));
  return parsed.toISOString().slice(0, 10);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function publicEnvelope(id, date, status, snapshot) {
  if (!Object.hasOwn(PROVIDERS, id)) throw new RateError('unsupported-provider', 'Unknown bank');
  isoDate(date);
  const validStatus = status?.schemaVersion === 1 && status.provider === id && status.requestedDate === date;
  const checkedAt = validStatus ? status.attemptedAt : null;
  const failure = { schemaVersion: 1, provider: id, requestedDate: date, checkedAt, ok: false };
  if (!validStatus || status.ok !== true) return failure;
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.provider !== id || snapshot.requestedDate !== date || snapshot.base !== 'USD' ||
      snapshot.rateDate !== status.rateDate || snapshot.fetchedAt !== status.fetchedAt || isoDate(snapshot.rateDate) > date ||
      !snapshot.rates || typeof snapshot.rates !== 'object' || Array.isArray(snapshot.rates)) throw new RateError('invalid-publication', 'Snapshot and status do not match');
  const rates = {};
  for (const [code, rate] of Object.entries(snapshot.rates)) {
    if (!/^[A-Z]{3}$/.test(code) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new RateError('invalid-publication', 'Invalid rate');
    rates[code] = rate;
  }
  if (rates.USD !== 1 || Object.keys(rates).length > 200 || !PROVIDERS[id].required.every(code => Object.hasOwn(rates, code))) {
    throw new RateError('invalid-publication', 'Missing required rates');
  }
  return { ...failure, ok: true, rateDate: snapshot.rateDate, rates };
}

export async function preparePublication({ date, dataDir, outputDir }) {
  date = isoDate(date);
  const startDate = historyStart(date);
  const source = path.resolve(dataDir);
  const target = path.resolve(outputDir);
  const relative = path.relative(source, target);
  const reverse = path.relative(target, source);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) ||
      (!reverse.startsWith('..' + path.sep) && !path.isAbsolute(reverse))) throw new Error('Publication and private data directories must be separate');
  // A fresh directory prevents previously published files leaking into a release.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target);
  const coverage = {};
  for (const id of Object.keys(PROVIDERS)) {
    coverage[id] = { ok: 0, unavailable: 0 };
    for (let day = startDate; day <= date; day = shiftDate(day, 1)) {
      const status = await readJson(path.join(source, 'status', id, day + '.json'));
      const snapshot = status?.ok ? await readJson(path.join(source, 'banks', id, day + '.json')) : null;
      const envelope = publicEnvelope(id, day, status, snapshot);
      await atomicJson(path.join(target, 'v1', id, day + '.json'), envelope);
      coverage[id][envelope.ok ? 'ok' : 'unavailable']++;
    }
  }
  const manifest = { schemaVersion: 1, startDate, endDate: date, coverage };
  await atomicJson(path.join(target, 'manifest.json'), manifest);
  return manifest;
}
