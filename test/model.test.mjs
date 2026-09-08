import test from 'node:test';
import assert from 'node:assert/strict';
import { bankNumber, isoDate, shiftDate, observation, makeSnapshot } from '../src/model.mjs';
import { PROVIDERS } from '../src/providers.mjs';

test('dates are strict, timezone-independent, and leap-year aware', () => {
  assert.equal(isoDate('08.09.2026'), '2026-09-08');
  assert.equal(isoDate('2026-09-08T00:00:00.000Z'), '2026-09-08');
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
  for (const bad of ['2026-02-30', '08/09/26', '', '../../data']) assert.throws(() => isoDate(bad));
});

test('locale parsing is explicit, invalid or zero values fail closed', () => {
  assert.equal(bankNumber('3,595.64', 'grouped'), 3595.64);
  assert.equal(bankNumber('87,4500', 'comma'), 87.45);
  for (const bad of ['0', '-1', 'NaN', 'Infinity', '1e20', '1oops', '']) assert.throws(() => bankNumber(bad));
  assert.throws(() => bankNumber('3,59.64', 'grouped'));
  assert.throws(() => bankNumber('1,700', 'decimal'));
});

test('bank nominals are normalized before cross conversion', () => {
  const rows = [observation('2026-09-08', 'USD', 3.2), observation('2026-09-08', 'EUR', 3.7), observation('2026-09-08', 'AMD', 8, 1000)];
  const snapshot = makeSnapshot(PROVIDERS.NBRB, '2026-09-08', rows, ['https://api.nbrb.by']);
  assert.equal(snapshot.rates.BYN, 3.2);
  assert.equal(snapshot.rates.EUR, 3.2 / 3.7);
  assert.equal(snapshot.rates.AMD, 400);
  assert.equal(snapshot.rates.USD, 1);
  assert.equal(snapshot.observations.find(r => r.currency === 'AMD').nominal, 1000);
});

test('ECB direction is inverted correctly and raw precision is retained', () => {
  const snapshot = makeSnapshot(PROVIDERS.ECB, '2026-09-08', [observation('2026-09-07', 'USD', 1.1622)], []);
  assert.equal(snapshot.rates.EUR, 1 / 1.1622);
  assert.equal(snapshot.rateDate, '2026-09-07');
});

test('BOM EUR is calculated from BOM, not ECB or a fixed peg', () => {
  const rows = [observation('2026-09-08', 'USD', '3,595.64', 1, 'grouped'), observation('2026-09-08', 'EUR', '4,175.44', 1, 'grouped')];
  const snapshot = makeSnapshot(PROVIDERS.BOM, '2026-09-08', rows, []);
  assert.equal(snapshot.rates.MNT, 3595.64);
  assert.equal(snapshot.rates.EUR, 3595.64 / 4175.44);
});

test('future publications are excluded, and different dates cannot be combined', () => {
  assert.throws(() => makeSnapshot(PROVIDERS.BOM, '2026-09-08', [observation('2026-09-08', 'USD', 3595), observation('2026-09-09', 'EUR', 4175)], []), { code: 'no-compatible-publication' });
  assert.throws(() => makeSnapshot(PROVIDERS.BOM, '2026-09-08', [observation('2026-09-07', 'USD', 3595), observation('2026-09-08', 'EUR', 4175)], []), { code: 'no-compatible-publication' });
  const past = [observation('2026-09-07', 'USD', 3590), observation('2026-09-07', 'EUR', 4170)];
  const next = observation('2026-09-09', 'USD', 3595);
  assert.equal(makeSnapshot(PROVIDERS.BOM, '2026-09-08', [...past, next], []).rateDate, '2026-09-07');
});

test('conflicting publication and bank base values are rejected', () => {
  assert.throws(() => makeSnapshot(PROVIDERS.ECB, '2026-09-08', [observation('2026-09-08', 'USD', 1.16), observation('2026-09-08', 'USD', 1.17)], []), { code: 'conflicting-rates' });
  assert.throws(() => makeSnapshot(PROVIDERS.ECB, '2026-09-08', [observation('2026-09-08', 'USD', 1.16), observation('2026-09-08', 'EUR', 2)], []), { code: 'invalid-pivot' });
});
