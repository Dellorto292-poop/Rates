import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { load } from 'cheerio';
import { RateError, isoDate, shiftDate, observation, bankNumber } from './model.mjs';

export const PROVIDERS = Object.freeze({
  CBAR: { id: 'CBAR', pivot: 'AZN', required: ['AZN', 'EUR'] },
  CBA: { id: 'CBA', pivot: 'AMD', required: ['AMD', 'EUR'] },
  NBRB: { id: 'NBRB', coverageVersion: 2, pivot: 'BYN', required: ['BYN', 'EUR'] },
  NBG: { id: 'NBG', pivot: 'GEL', required: ['GEL', 'EUR'] },
  NBK: { id: 'NBK', pivot: 'KZT', required: ['KZT', 'EUR'] },
  NBKR: { id: 'NBKR', coverageVersion: 2, pivot: 'KGS', required: ['KGS', 'EUR'] },
  ECB: { id: 'ECB', pivot: 'EUR', required: ['EUR'], direction: 'foreign-per-pivot' },
  BOM: { id: 'BOM', pivot: 'MNT', required: ['MNT', 'EUR'] },
  CBR: { id: 'CBR', pivot: 'RUB', required: ['RUB', 'EUR'] },
  CBU: { id: 'CBU', pivot: 'UZS', required: ['UZS', 'AZN', 'EUR'] }
});
for (const spec of Object.values(PROVIDERS)) {
  spec.coverageVersion ||= 1;
  spec.direction ||= 'pivot-per-foreign';
  Object.freeze(spec.required);
  Object.freeze(spec);
}

function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) {
    throw new RateError('invalid-xml', 'Invalid or unsafe bank XML');
  }
  return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(text);
}
function json(text) {
  try { return JSON.parse(text); } catch { throw new RateError('invalid-json', 'Invalid bank JSON'); }
}
function array(value) {
  if (!Array.isArray(value)) throw new RateError('invalid-schema', 'Expected a bank data array');
  return value;
}
function nodes(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function required(value) {
  if (!value || typeof value !== 'object') throw new RateError('invalid-schema', 'Expected bank response structure is missing');
  return value;
}
function localDate(date, separator = '.') { return date.slice(8) + separator + date.slice(5, 7) + separator + date.slice(0, 4); }

// Bank-owned archive IDs and current nominal. Reviewed 2026-09-09.
// Retired currencies/redenominated IDs (including BYR) are intentionally excluded.
export const SUPPORTED_CURRENCIES = Object.freeze(['USD','AMD','AZN','BYN','EUR','GEL','KGS','KZT','MNT','RUB','UZS']);
export const NBKR_CURRENCIES = Object.freeze([
  ['USD',15],['EUR',20],['RUB',44],['KZT',40],
  ['AMD',38,10],['AZN',82],['GEL',102],['MNT',106],['BYN',160],['UZS',200,10]
].map(row => Object.freeze(row)));
const NBKR_DAILY = new Set(['USD','EUR','RUB','KZT','CNY']);

export function parseProvider(id, text, context = {}) {
  if (id === 'CBAR') {
    const root = required(xml(text).ValCurs);
    return nodes(root.ValType).flatMap(group => nodes(group.Valute))
      .filter(row => !['XAU', 'XAG', 'XPT', 'XPD'].includes(row['@_Code']))
      .map(row => observation(root['@_Date'], row['@_Code'] === 'SDR' ? 'XDR' : row['@_Code'], row.Value, row.Nominal));
  }
  if (id === 'CBU') return array(json(text)).map(row => observation(row.Date, row.Ccy, row.Rate, row.Nominal));
  if (id === 'NBRB') return array(json(text)).map(row => observation(row.Date, row.Cur_Abbreviation, row.Cur_OfficialRate, row.Cur_Scale));
  if (id === 'NBG') return array(json(text)).flatMap(day => array(day.currencies).map(row => observation(day.date, row.code, row.rate, row.quantity)));
  if (id === 'BOM') {
    const data = json(text);
    if (data.success === false) throw new RateError('bank-error', 'Bank reported unsuccessful response');
    return array(data.data).flatMap(row => {
      const date = isoDate(row.RATE_DATE);
      // The bank returns its complete archive even for a bounded request.
      if (context.startDate && date < context.startDate || context.date && date > context.date) return [];
      return Object.entries(row).filter(([code, value]) => /^[A-Z]{3}$/.test(code) && !['SDR', 'XAU', 'XAG'].includes(code) && value != null && String(value).trim() !== '')
        .map(([code, value]) => observation(date, code, value, 1, 'grouped'));
    });
  }
  if (id === 'NBK') {
    const root = required(xml(text).rates);
    return nodes(root.item).map(row => observation(root.date, row.title, row.description, row.quant));
  }
  if (id === 'CBR') {
    const root = required(xml(text).ValCurs);
    return nodes(root.Valute).map(row => {
      const result = observation(root['@_Date'], row.CharCode, row.Value, row.Nominal, 'comma');
      // CBR also publishes a more precise per-unit figure for scaled currencies.
      if (row.VunitRate != null && row.VunitRate !== '') {
        result.publishedUnitRate = bankNumber(row.VunitRate, 'comma-scientific');
        result.unitRate = result.publishedUnitRate;
      }
      return result;
    });
  }
  if (id === 'CBA') {
    const body = required(xml(text).Envelope?.Body);
    if (body.Fault) throw new RateError('soap-fault', 'Bank returned SOAP fault');
    const root = required(body.ExchangeRatesByDateResponse?.ExchangeRatesByDateResult);
    isoDate(root.CurrentDate);
    return nodes(root.Rates?.ExchangeRate).filter(row => !['XAU', 'XAG'].includes(row.ISO))
      .map(row => observation(root.CurrentDate, row.ISO, row.Rate, row.Amount));
  }
  if (id === 'NBKR') {
    // Parse the archive table structurally; headings and unrelated tables are ignored.
    const $ = load(text);
    const records = [];
    if (context.bankId) {
      const label = $('select[name=valuta_id] option').filter((_i, el) => $(el).attr('value') === String(context.bankId)).text().trim();
      if (Number(label.match(/^([0-9]+)/)?.[1]) !== (context.nominal || 1)) {
        throw new RateError('invalid-nominal', 'NBKR archive nominal changed');
      }
    }
    $('tr').each((_index, element) => {
      const dateCell = $(element).children('td.stat-center');
      const rateCell = $(element).children('td.stat-right');
      if (dateCell.length !== 1 || rateCell.length !== 1) return;
      records.push({ ...observation(dateCell.text().trim(), context.currency, rateCell.text().trim(), context.nominal || 1, 'comma'), frequency: NBKR_DAILY.has(context.currency) ? 'daily' : 'weekly' });
    });
    if (!records.length) throw new RateError('invalid-schema', 'NBKR archive table not found');
    return records;
  }
  if (id === 'ECB') {
    const data = json(text);
    const dimensions = required(data.structure?.dimensions);
    const seriesDims = array(dimensions.series);
    const times = array(dimensions.observation).find(d => d.id === 'TIME_PERIOD');
    const values = array(times?.values);
    const records = [];
    for (const dataset of array(data.dataSets)) {
      for (const [key, series] of Object.entries(required(dataset.series))) {
        const indexes = key.split(':').map(Number);
        const dimension = name => {
          const index = seriesDims.findIndex(d => d.id === name);
          return seriesDims[index]?.values[indexes[index]]?.id;
        };
        if (dimension('FREQ') !== 'D' || dimension('CURRENCY_DENOM') !== 'EUR' || dimension('EXR_TYPE') !== 'SP00') {
          throw new RateError('invalid-schema', 'Unexpected ECB series dimensions');
        }
        for (const [index, value] of Object.entries(required(series.observations))) {
          if (value[0] == null) continue;
          records.push(observation(values[Number(index)]?.id, dimension('CURRENCY'), value[0]));
        }
      }
    }
    return records;
  }
  throw new RateError('unsupported-provider', 'No direct adapter for ' + id);
}

export async function fetchProvider(id, date, client, { lookbackDays = 14 } = {}) {
  if (!Object.hasOwn(PROVIDERS, id)) throw new RateError('unsupported-provider', 'No direct adapter for ' + id);
  date = isoDate(date);
  const startDate = shiftDate(date, -lookbackDays);
  const sources = [];
  const responses = [];
  const finish = observations => ({ observations: observations.filter(row => SUPPORTED_CURRENCIES.includes(row.currency)), sources, responses });
  async function get(url, options = {}) {
    const result = await client.request(url, options);
    sources.push(result.url);
    responses.push({ url: result.url, sha256: result.sha256, bytes: result.bytes });
    return result.text;
  }
  if (id === 'BOM') {
    const text = await get('https://www.mongolbank.mn/en/currency-rate-movement/data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate, endDate: date })
    });
    return finish(parseProvider(id, text, { startDate, date }));
  }
  if (id === 'ECB') {
    // The application's only ECB-supported currencies are USD and native EUR.
    const url = new URL('https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A');
    url.search = new URLSearchParams({ startPeriod: startDate, endPeriod: date, format: 'jsondata' });
    return finish(parseProvider(id, await get(url.href)));
  }
  if (id === 'NBKR') {
    const observations = [];
    // The IDs are bank-owned archive identifiers, not ISO numeric codes.
    for (const [currency, bankId, nominal = 1] of NBKR_CURRENCIES) {
      const url = new URL('https://www.nbkr.kg/index1.jsp');
      url.search = new URLSearchParams({
        item: '1562', lang: 'ENG', valuta_id: String(bankId),
        beg_day: startDate.slice(8), beg_month: startDate.slice(5, 7), beg_year: startDate.slice(0, 4),
        end_day: date.slice(8), end_month: date.slice(5, 7), end_year: date.slice(0, 4)
      });
      observations.push(...parseProvider(id, await get(url.href), { currency, bankId, nominal }));
    }
    return finish(observations);
  }
  // Some daily APIs return no data on non-publication days. Search backwards,
  // never forwards; transport/schema failures must not masquerade as a holiday.
  for (let offset = 0; offset <= lookbackDays; offset++) {
    const day = shiftDate(date, -offset);
    let url;
    let options = {};
    if (id === 'CBAR') url = 'https://www.cbar.az/currencies/' + localDate(day) + '.xml';
    if (id === 'CBU') url = 'https://cbu.uz/en/arkhiv-kursov-valyut/json/all/' + day + '/';
    if (id === 'NBRB') url = 'https://api.nbrb.by/exrates/rates?ondate=' + day + '&periodicity=0';
    if (id === 'NBG') url = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/?date=' + day;
    if (id === 'NBK') url = 'https://nationalbank.kz/rss/get_rates.cfm?fdate=' + localDate(day);
    if (id === 'CBR') {
      url = 'https://www.cbr.ru/scripts/XML_daily.asp?date_req=' + localDate(day, '/');
      options.encoding = 'windows-1251';
    }
    if (id === 'CBA') {
      url = 'https://api.cba.am/exchangerates.asmx';
      options = {
        method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://www.cba.am/ExchangeRatesByDate"' },
        body: '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ExchangeRatesByDate xmlns="http://www.cba.am/"><date>' + day + '</date></ExchangeRatesByDate></soap:Body></soap:Envelope>'
      };
    }
    const observations = parseProvider(id, await get(url, options));
    if (observations.length) {
      if (id === 'NBRB') {
        // Monthly quotes and their USD conversion share the first day of that month.
        const month = day.slice(0, 7) + '-01';
        const monthly = parseProvider(id, await get('https://api.nbrb.by/exrates/rates?ondate=' + month + '&periodicity=1'));
        if (monthly.some(row => row.date !== month)) throw new RateError('invalid-date', 'Unexpected NBRB monthly effective date');
        if (monthly.length) {
          const anchor = day === month ? observations : parseProvider(id, await get('https://api.nbrb.by/exrates/rates?ondate=' + month + '&periodicity=0'));
          observations.push(...anchor, ...monthly.map(row => ({ ...row, frequency: 'monthly' })));
        }
      }
      return finish(observations);
    }
  }
  throw new RateError('no-publication', 'No bank publication in configured lookback window');
}
