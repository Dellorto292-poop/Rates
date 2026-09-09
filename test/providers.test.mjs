import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProvider, fetchProvider, NBKR_CURRENCIES } from '../src/providers.mjs';

const date = '2026-09-08';
const check = (id, payload, expected, context) => {
  const rows = parseProvider(id, typeof payload === 'string' ? payload : JSON.stringify(payload), context);
  assert.equal(rows[0].date, date);
  assert.equal(rows[0].currency, 'USD');
  assert.equal(rows[0].unitRate, expected);
};
test('CBU JSON date, scale, and decimals', () => check('CBU', [{ Date: '08.09.2026', Ccy: 'USD', Rate: '12000.20', Nominal: '1' }], 12000.2));
test('NBRB JSON date and currency scale', () => check('NBRB', [{ Date: date + 'T00:00:00', Cur_Abbreviation: 'USD', Cur_OfficialRate: 3.2, Cur_Scale: 1 }], 3.2));
test('NBG uses effective publication date, not currency update timestamp', () => check('NBG', [{ date, currencies: [{ code: 'USD', rate: 2.7, quantity: 1, date: '2026-09-07T17:00:00Z' }] }], 2.7));
test('NBK XML nominals', () => check('NBK', '<rates><date>08.09.2026</date><item><title>USD</title><description>480.00</description><quant>1</quant></item></rates>', 480));
test('CBR XML attributes and comma decimal', () => check('CBR', '<ValCurs Date="08.09.2026"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>80,50</Value></Valute></ValCurs>', 80.5));
test('CBR precise unit quote takes precedence while original nominal stays available', () => {
  const [row] = parseProvider('CBR', '<ValCurs Date="08.09.2026"><Valute><CharCode>AMD</CharCode><Nominal>100</Nominal><Value>23,6984</Value><VunitRate>0,2369841</VunitRate></Valute></ValCurs>');
  assert.equal(row.unitRate, 0.2369841);
  assert.equal(row.nominal, 100);
  assert.equal(row.publishedRate, 23.6984);
});
test('CBA SOAP namespace and response dates', () => check('CBA', '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ExchangeRatesByDateResponse><ExchangeRatesByDateResult><CurrentDate>2026-09-08T00:00:00</CurrentDate><Rates><ExchangeRate><ISO>USD</ISO><Amount>1</Amount><Rate>380.12</Rate></ExchangeRate></Rates></ExchangeRatesByDateResult></ExchangeRatesByDateResponse></soap:Body></soap:Envelope>', 380.12));
test('BOM filters the archive before parsing irrelevant obsolete currencies', () => check('BOM', {success:true,data:[{RATE_DATE:'2001-01-02',USD:'bad'},{RATE_DATE:date,USD:'3,595.64'},{RATE_DATE:'2026-09-09',USD:'4,000.00'}]}, 3595.64, {startDate:'2026-09-01',date}));
test('NBKR historical HTML table, not the future-dated live feed', () => check('NBKR', '<table><tr><th>Date</th><th>Rate</th></tr><tr><td class="stat-center"><!--date-->08.09.2026<!--date--></td><td class="stat-right"><!--value-->87,4500<!--value-->&nbsp;</td></tr></table>', 87.45, {currency:'USD'}));
test('ECB dimension indexes and observation dates', () => check('ECB', {
  dataSets:[{series:{'0:0:0:0':{observations:{'0':[1.1622]}}}}],
  structure:{dimensions:{series:[{id:'FREQ',values:[{id:'D'}]},{id:'CURRENCY',values:[{id:'USD'}]},{id:'CURRENCY_DENOM',values:[{id:'EUR'}]},{id:'EXR_TYPE',values:[{id:'SP00'}]}],observation:[{id:'TIME_PERIOD',values:[{id:date}]}]}}
},1.1622));
test('CBR precise unit field accepts official scientific notation and rejects overflow', () => {
  const payload = value => '<ValCurs Date="25.05.2026"><Valute><CharCode>IRR</CharCode><Nominal>1000000</Nominal><Value>48,1017</Value><VunitRate>' + value + '</VunitRate></Valute></ValCurs>';
  assert.equal(parseProvider('CBR', payload('4,81017E-05'))[0].unitRate, 0.0000481017);
  for (const value of ['4E999', '4E-999', '4E-', '-4E-5', 'NaN']) assert.throws(() => parseProvider('CBR', payload(value)), { code: 'invalid-number' });
});

test('invalid schemas and XML entities cannot become successful rates', () => {
  for (const [id, body] of [['CBU','{}'],['NBG','{"error":"x"}'],['BOM','{"success":false,"data":[]}'],['NBKR','<html>Maintenance</html>'],['CBR','<!DOCTYPE test [<!ENTITY x SYSTEM "file:///secret">]><ValCurs/>'],['NBK','<rates><item></rates>'],['CBA','<Envelope><Body><Fault/></Body></Envelope>']]) assert.throws(()=>parseProvider(id,body));
  assert.throws(()=>parseProvider('UNKNOWN','{}'),{code:'unsupported-provider'});
});
test('NBKR archive requests pin both range ends and separate bank currency IDs', async () => {
  const requests=[];
  await fetchProvider('NBKR',date,{request:async url=>{
    const parsed = new URL(url); requests.push(parsed);
    const [code, id, nominal = 1] = NBKR_CURRENCIES.find(row => String(row[1]) === parsed.searchParams.get('valuta_id'));
    return {url,text:`<select name="valuta_id"><option value="${id}">${nominal} ${code}</option></select><table><tr><td class="stat-center">08.09.2026</td><td class="stat-right">87,45</td></tr></table>`};
  }});
  assert.deepEqual(requests.map(u=>u.searchParams.get('valuta_id')), NBKR_CURRENCIES.map(row => String(row[1])));
  assert.ok(requests.every(u=>u.searchParams.get('end_day')==='08'&&u.searchParams.get('end_year')==='2026'));
});
test('empty daily publications walk backwards but network errors do not become holidays', async () => {
  const requests=[];
  const result=await fetchProvider('CBU',date,{request:async url=>{requests.push(url);return {url,text:requests.length===1?'[]':'[{"Date":"07.09.2026","Ccy":"USD","Rate":"12000","Nominal":"1"}]'}}});
  assert.equal(result.observations[0].date,'2026-09-07');
  assert.ok(requests[1].endsWith('/2026-09-07/'));
  let attempts=0;
  await assert.rejects(fetchProvider('CBU',date,{request:async()=>{attempts++;throw new Error('network')}}));
  assert.equal(attempts,1);
});
