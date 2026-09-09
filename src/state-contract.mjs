// Standard-library-only contract, also used by the write-privileged checkpoint job.
export const BANK_CURRENCIES = Object.freeze({ CBAR: ['AZN', 'EUR'], CBA: ['AMD', 'EUR'], NBRB: ['BYN', 'EUR'], NBG: ['GEL', 'EUR'], NBK: ['KZT', 'EUR'], NBKR: ['KGS', 'EUR'], ECB: ['EUR'], BOM: ['MNT', 'EUR'], CBR: ['RUB', 'EUR'], CBU: ['UZS', 'AZN', 'EUR'] });
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return value;
}
export function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  day(value.slice(0, 10));
  return value;
}
function identity(value, bank, date) {
  day(date);
  if (!Object.hasOwn(BANK_CURRENCIES, bank) || !value || value.schemaVersion !== 1 || value.provider !== bank || value.requestedDate !== date) throw new Error('Invalid state identity');
}
export function cleanSnapshot(value, bank, date) {
  identity(value, bank, date);
  if (value.base !== 'USD' || day(value.rateDate) > date || stamp(value.fetchedAt).slice(0, 10) < date) throw new Error('Invalid snapshot dates/base');
  if (!value.rates || typeof value.rates !== 'object' || Array.isArray(value.rates)) throw new Error('Invalid rates');
  const rates = {};
  for (const [code, rate] of Object.entries(value.rates)) {
    if (!/^[A-Z]{3}$/.test(code) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new Error('Invalid rate');
    rates[code] = rate;
  }
  if (Object.keys(rates).length > 200 || rates.USD !== 1 || !BANK_CURRENCIES[bank].every(code => Object.hasOwn(rates, code))) throw new Error('Incomplete rates');
  const metadata = cleanRateMetadata(value, rates, date);
  const coverageVersion = value.coverageVersion ?? 1;
  if (!Number.isSafeInteger(coverageVersion) || coverageVersion < 1 || coverageVersion > 100) throw new Error('Invalid coverage version');
  return { schemaVersion: 1, provider: bank, requestedDate: date, rateDate: value.rateDate, fetchedAt: value.fetchedAt, base: 'USD', rates, ...metadata, coverageVersion };
}
export function cleanStatus(value, bank, date) {
  identity(value, bank, date);
  if (typeof value.ok !== 'boolean' || stamp(value.attemptedAt).slice(0, 10) < date) throw new Error('Invalid status');
  const result = { schemaVersion: 1, provider: bank, requestedDate: date, attemptedAt: value.attemptedAt, ok: value.ok };
  if (value.ok) {
    if (day(value.rateDate) > date || stamp(value.fetchedAt).slice(0, 10) < date) throw new Error('Invalid success status');
    result.rateDate = value.rateDate;
    result.fetchedAt = value.fetchedAt;
  } else result.error = 'collection-error';
  return result;
}

export function cleanRateMetadata(value, rates, requestedDate) {
  const rateDates = {}, frequencies = {};
  for (const field of ['rateDates', 'frequencies']) {
    if (value[field] != null && (typeof value[field] !== 'object' || Array.isArray(value[field]) ||
        Object.keys(value[field]).length !== Object.keys(rates).length || Object.keys(value[field]).some(code => !Object.hasOwn(rates, code)))) throw new Error('Invalid currency metadata');
  }
  for (const code of Object.keys(rates)) {
    const date = value.rateDates == null ? value.rateDate : value.rateDates[code];
    const frequency = value.frequencies == null ? 'daily' : value.frequencies[code];
    if (day(date) > value.rateDate || date > requestedDate || !['daily', 'weekly', 'monthly'].includes(frequency)) throw new Error('Invalid currency date/frequency');
    if (frequency === 'daily' && date !== value.rateDate ||
        frequency === 'weekly' && Date.parse(requestedDate) - Date.parse(date) > 6 * 86400000 ||
        frequency === 'monthly' && date !== requestedDate.slice(0, 7) + '-01') throw new Error('Expired or inconsistent currency date');
    rateDates[code] = date;
    frequencies[code] = frequency;
  }
  return { rateDates, frequencies };
}
