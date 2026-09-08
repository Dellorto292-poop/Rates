import test from 'node:test';
import assert from 'node:assert/strict';
import { historyStart, publicEnvelope } from '../src/publication.mjs';

const date = '2026-09-08';
const status = { schemaVersion: 1, provider: 'BOM', requestedDate: date, attemptedAt: date + 'T12:00:00Z', fetchedAt: date + 'T12:00:01Z', rateDate: date, ok: true };
const snapshot = { schemaVersion: 1, provider: 'BOM', requestedDate: date, fetchedAt: status.fetchedAt, rateDate: date, base: 'USD', rates: { USD: 1, MNT: 3595.64, EUR: 0.86 }, privateField: 'not published', sources: ['not published'] };
test('six calendar months use calendar boundaries, including short months', () => {
  assert.equal(historyStart(date), '2026-03-08');
  assert.equal(historyStart('2026-08-31'), '2026-02-28');
  assert.equal(historyStart('2024-08-31'), '2024-02-29');
});
test('public envelope contains only allowlisted rate data', () => {
  const result = publicEnvelope('BOM', date, status, snapshot);
  assert.deepEqual(Object.keys(result).sort(), ['schemaVersion', 'provider', 'requestedDate', 'checkedAt', 'ok', 'rateDate', 'rates'].sort());
  assert.equal(result.rates.MNT, 3595.64);
  assert.equal(JSON.stringify(result).includes('not published'), false);
});
test('failed update or missing status never publishes previous rates as successful', () => {
  for (const value of [null, { ...status, ok: false }, { ...status, provider: 'CBR' }]) {
    const result = publicEnvelope('BOM', date, value, snapshot);
    assert.equal(result.ok, false);
    assert.equal(result.rates, undefined);
  }
});
test('torn writes and malformed rates abort publication', () => {
  for (const value of [{ ...snapshot, fetchedAt: 'wrong' }, { ...snapshot, rates: { USD: 1, EUR: 0.8 } }, { ...snapshot, rates: { USD: 1, EUR: 0.8, MNT: '<script>' } }]) assert.throws(() => publicEnvelope('BOM', date, status, value));
});
