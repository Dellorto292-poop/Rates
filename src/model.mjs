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
    const rateDates = Object.fromEntries(Object.keys(rates).map(code => [code, rateDate]));
    const frequencies = Object.fromEntries(Object.keys(rates).map(code => [code, group.get(code)?.frequency || 'daily']));
    // Extend only explicitly periodic series, never carry forward a missing daily quote.
    // Both conversion legs still come from exactly the periodic publication's date.
    for (const periodicDate of [...groups.keys()].sort().reverse()) {
      const periodic = groups.get(periodicDate);
      if (!periodic.has('USD')) continue;
      for (const [code, item] of periodic) {
        if (Object.hasOwn(rates, code) || !['weekly', 'monthly'].includes(item.frequency)) continue;
        if (item.frequency === 'weekly' && periodicDate < shiftDate(date, -6)) continue;
        if (item.frequency === 'monthly' && periodicDate !== date.slice(0, 7) + '-01') continue;
        const rate = provider.direction === 'foreign-per-pivot' ? item.unitRate / periodic.get('USD').unitRate : periodic.get('USD').unitRate / item.unitRate;
        if (!Number.isFinite(rate) || rate <= 0) throw new RateError('invalid-cross-rate', 'Invalid periodic cross rate');
        rates[code] = rate;
        rateDates[code] = periodicDate;
        frequencies[code] = item.frequency;
      }
    }
    return {
      schemaVersion: 1, provider: provider.id, requestedDate: date, rateDate,
      fetchedAt, base: 'USD', pivot: provider.pivot, direction: provider.direction,
      coverageVersion: provider.coverageVersion || 1, rates, rateDates, frequencies, observations: [...group.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      sources: [...new Set(sources)]
    };
  }
  throw new RateError('no-compatible-publication', 'No publication on or before the requested date with all required currencies');
}
