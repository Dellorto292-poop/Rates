import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProvider, fetchProvider, PROVIDERS } from '../src/providers.mjs';
import { makeSnapshot, observation as o } from '../src/model.mjs';
import { cleanSnapshot } from '../src/state-contract.mjs';
import { publicEnvelope } from '../src/publication.mjs';
const date = '2026-09-09';
const at = date + 'T12:00:00Z';
const periodic = (d,c,r,frequency) => ({...o(d,c,r),frequency});
const rows = [o(date,'USD',90),o(date,'EUR',100),o('2026-09-05','USD',80),periodic('2026-09-05','AMD',2,'weekly')];
test('periodic cross uses USD on the periodic date, without inventing daily quotes',()=>{
 const s=makeSnapshot(PROVIDERS.NBKR,date,[...rows,o('2026-09-05','JPY',3)],[],at);
 assert.equal(s.rates.AMD,40); assert.equal(s.rates.JPY,undefined);
 assert.equal(s.rateDates.AMD,'2026-09-05'); assert.equal(s.frequencies.AMD,'weekly');
 assert.equal(s.rateDates.EUR,date); assert.equal(s.rates.EUR,0.9);
 const missing=makeSnapshot(PROVIDERS.NBKR,date,rows.filter(r=>!(r.currency==='USD'&&r.date!==date)),[],at);
 assert.equal(missing.rates.AMD,undefined);
 const expired=makeSnapshot(PROVIDERS.NBKR,'2026-09-12',rows,[],at); assert.equal(expired.rates.AMD,undefined);
});
test('monthly quotes expire at the next month and require a same-date USD anchor',()=>{
 const r=[o(date,'USD',3),o(date,'EUR',4),o('2026-09-01','USD',2),periodic('2026-09-01','AZN',1,'monthly')];
 const s=makeSnapshot(PROVIDERS.NBRB,date,r,[],at); assert.equal(s.rates.AZN,2); assert.equal(s.rateDates.AZN,'2026-09-01');
 assert.equal(makeSnapshot(PROVIDERS.NBRB,'2026-10-01',r,[],at).rates.AZN,undefined);
});
test('v2 and checkpoint retain safe metadata; v1 preserves its old shape and daily quotes',()=>{
 const s=makeSnapshot(PROVIDERS.NBKR,date,rows,[],at);
 const status={schemaVersion:1,provider:'NBKR',requestedDate:date,attemptedAt:at,fetchedAt:at,rateDate:date,ok:true};
 const clean=cleanSnapshot(s,'NBKR',date); assert.equal(clean.frequencies.AMD,'weekly'); assert.equal(clean.coverageVersion,2);
 const v1=publicEnvelope('NBKR',date,status,clean); assert.equal(v1.rates.AMD,undefined); assert.equal(v1.rateDates,undefined);
 const v2=publicEnvelope('NBKR',date,status,clean,2); assert.equal(v2.rates.AMD,40); assert.equal(v2.rateDates.AMD,'2026-09-05');
 for (const patch of [{rateDates:{...s.rateDates,AMD:'2026-09-10'}},{frequencies:{...s.frequencies,AMD:'<script>'}},{rateDates:{}},{coverageVersion:'2'}]) assert.throws(()=>cleanSnapshot({...s,...patch},'NBKR',date));
});
test('CBAR XML honors effective date, currency attributes, scaled values, and SDR alias',()=>{
 const r=parseProvider('CBAR','<ValCurs Date="04.09.2026"><ValType><Valute Code="USD"><Nominal>1</Nominal><Value>1.7</Value></Valute><Valute Code="JPY"><Nominal>100</Nominal><Value>1.2</Value></Valute><Valute Code="SDR"><Nominal>1</Nominal><Value>2</Value></Valute><Valute Code="XAU"><Nominal>1</Nominal><Value>6000</Value></Valute></ValType></ValCurs>');
 assert.equal(r[0].date,'2026-09-04'); assert.equal(r[1].unitRate,.012); assert.equal(r[2].currency,'XDR'); assert.equal(r.length,3);
});
test('NBRB monthly and daily legs use first-of-month API data, not request-day USD',async()=>{
 const urls=[]; const r=await fetchProvider('NBRB',date,{request:async url=>{urls.push(url); const u=new URL(url), d=u.searchParams.get('ondate'), month=u.searchParams.get('periodicity')==='1';
 return {url,text:JSON.stringify(month?[{Date:d,Cur_Abbreviation:'AZN',Cur_OfficialRate:1,Cur_Scale:1}]:[{Date:d,Cur_Abbreviation:'USD',Cur_OfficialRate:d===date?3:2,Cur_Scale:1},{Date:d,Cur_Abbreviation:'EUR',Cur_OfficialRate:4,Cur_Scale:1}])};}});
 assert.equal(urls.length,3); const s=makeSnapshot(PROVIDERS.NBRB,date,r.observations,[],at); assert.equal(s.rates.AZN,2); assert.equal(s.frequencies.AZN,'monthly');
});
test('NBKR nominal scales and altered archive labels cannot silently change amounts',()=>{
 const html='<select name="valuta_id"><option value="38">10 Armenian dram</option></select><table><tr><td class="stat-center">05.09.2026</td><td class="stat-right">2,4</td></tr></table>';
 assert.equal(parseProvider('NBKR',html,{currency:'AMD',bankId:38,nominal:10})[0].unitRate,.24);
 assert.throws(()=>parseProvider('NBKR',html,{currency:'AMD',bankId:38,nominal:1}),{code:'invalid-nominal'});
});
test('collection and v2 publication are limited to working application currencies',async()=>{
 const r=await fetchProvider('CBU',date,{request:async url=>({url,text:JSON.stringify(['USD','EUR','UZS','AZN','GBP'].map(Ccy=>({Date:date,Ccy,Rate:'1',Nominal:'1'})))})});
 assert.equal(r.observations.some(row=>row.currency==='GBP'),false);
 const s=makeSnapshot(PROVIDERS.CBU,date,['USD','EUR','UZS','AZN','GBP'].map(c=>o(date,c,1)),[],at);
 const status={schemaVersion:1,provider:'CBU',requestedDate:date,attemptedAt:at,fetchedAt:at,rateDate:date,ok:true};
 assert.equal(publicEnvelope('CBU',date,status,s,1).rates.GBP,1);
 const v2=publicEnvelope('CBU',date,status,s,2); assert.equal(v2.rates.GBP,undefined); assert.equal(v2.rateDates.GBP,undefined);
});
