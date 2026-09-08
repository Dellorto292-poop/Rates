export class RateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function isoDate(value) {
  const text = String(value ?? '').trim();
  let date;
  if (/^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/.test(text)) date = text.slice(0, 10);
  else if (/^\d{2}[./]\d{2}[./]\d{4}$/.test(text)) date = text.slice(6) + '-' + text.slice(3, 5) + '-' + text.slice(0, 2);
  else throw new RateError('invalid-date', 'Invalid publication date');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RateError('invalid-date', 'Invalid calendar date');
  }
  return date;
}

export function shiftDate(date, days) {
  const parsed = new Date(isoDate(date) + 'T00:00:00Z');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function bankNumber(value, style = 'decimal') {
  const text = String(value ?? '').trim().replace(/[\s\u00a0]/g, '');
  const pattern = style === 'grouped'
    ? /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
    : style === 'comma-scientific' ? /^\d+(?:[.,]\d+)?(?:[Ee][+-]?\d+)?$/
      : style === 'comma' ? /^\d+(?:[.,]\d+)?$/ : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(text)) throw new RateError('invalid-number', 'Invalid rate or nominal');
  const number = Number(style === 'grouped' ? text.replaceAll(',', '') : text.replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw new RateError('invalid-number', 'Rate and nominal must be positive');
  return number;
}

export function observation(date, currency, value, nominal = 1, style = 'decimal') {
  if (!/^[A-Z]{3}$/.test(currency)) throw new RateError('invalid-currency', 'Invalid currency code');
  const publishedRate = bankNumber(value, style);
  const scale = bankNumber(nominal);
  const unitRate = publishedRate / scale;
  if (!Number.isFinite(unitRate) || unitRate <= 0) throw new RateError('invalid-number', 'Invalid normalized rate');
  return { date: isoDate(date), currency, publishedRate, nominal: scale, unitRate };
}

// Both legs must come from one publication. Never combine dates or providers.
export function makeSnapshot(provider, requestedDate, observations, sources, fetchedAt = new Date().toISOString()) {
  const date = isoDate(requestedDate);
  const groups = new Map();
  for (const item of observations) {
    if (isoDate(item.date) > date) continue;
    if (!groups.has(item.date)) groups.set(item.date, new Map());
    const group = groups.get(item.date);
    const prior = group.get(item.currency);
    if (prior && prior.unitRate !== item.unitRate) throw new RateError('conflicting-rates', 'Conflicting rates for one currency and date');
    group.set(item.currency, item);
  }
  for (const rateDate of [...groups.keys()].sort().reverse()) {
    const group = groups.get(rateDate);
    if (group.has(provider.pivot) && group.get(provider.pivot).unitRate !== 1) {
      throw new RateError('invalid-pivot', 'Bank base currency must equal one');
    }
    group.set(provider.pivot, observation(rateDate, provider.pivot, 1));
    if (!['USD', ...provider.required].every(code => group.has(code))) continue;
    const usd = group.get('USD').unitRate;
    const rates = {};
    for (const code of [...group.keys()].sort()) {
      const unit = group.get(code).unitRate;
      const rate = provider.direction === 'foreign-per-pivot' ? unit / usd : usd / unit;
      if (!Number.isFinite(rate) || rate <= 0) throw new RateError('invalid-cross-rate', 'Invalid USD cross rate');
      rates[code] = rate;
    }
    rates.USD = 1;
    return {
      schemaVersion: 1, provider: provider.id, requestedDate: date, rateDate,
      fetchedAt, base: 'USD', pivot: provider.pivot, direction: provider.direction,
      rates, observations: [...group.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      sources: [...new Set(sources)]
    };
  }
  throw new RateError('no-compatible-publication', 'No publication on or before the requested date with all required currencies');
}
