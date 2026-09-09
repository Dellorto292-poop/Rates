import test from 'node:test';
import assert from 'node:assert/strict';
import { update } from '../src/update.mjs';
const date = '2026-09-09';
const good = provider => ({ provider, ok: true });
const bad = (provider, error = 'network-error') => ({ provider, ok: false, error });
test('delayed pass retries only the failed bank/date and clears only a recovered failure',async()=>{
 const calls=[], waits=[];
 const result=await update({date,outputDir:'unused',sleep:async ms=>waits.push(ms),historyImpl:async({onResult})=>onResult({requestedDate:'2026-08-31',...bad('NBRB')}),
 collectImpl:async options=>{calls.push(options);return {results:options.providers?[good(options.providers[0])]:[good('CBA'),options.date===date?bad('CBAR'):good('CBAR')]};}});
 assert.deepEqual(result,{ok:true,retried:2}); assert.deepEqual(waits,[5000]);
 assert.deepEqual(calls.slice(3).map(c=>[c.date,c.providers]),[[date,['CBAR']],['2026-08-31',['NBRB']]]);
});
test('recent success supersedes a failed backfill attempt without another retry',async()=>{
 const result=await update({date,outputDir:'unused',historyImpl:async({onResult})=>onResult({requestedDate:date,...bad('CBAR')}),sleep:async()=>assert.fail('No delay needed'),collectImpl:async()=>({results:[good('CBAR')]})});
 assert.deepEqual(result,{ok:true,retried:0});
});
test('persistent transport failure and schema failures remain failed',async()=>{
 for(const error of ['network-error','timeout','http-429','http-503','invalid-xml','invalid-encoding','stale-response','invalid-number','http-404']){
  let calls=0;const result=await update({date,outputDir:'unused',historyImpl:async()=>{},sleep:async()=>{},collectImpl:async()=>{calls++;return{results:[bad('CBAR',error)]};}});
  assert.equal(result.ok,false); assert.equal(calls,['network-error','timeout','http-429','http-503'].includes(error)?6:3);
 }
});
test('a large archive outage cannot trigger unbounded retry requests',async()=>{
 let calls=0;
 const result=await update({date,outputDir:'unused',historyImpl:async({onResult})=>{for(let day=1;day<=28;day++)onResult({requestedDate:'2026-08-'+String(day).padStart(2,'0'),...bad('CBAR')});},sleep:async()=>{},collectImpl:async()=>{calls++;return{results:[good('CBAR')]};}});
 assert.equal(result.retried,10); assert.equal(calls,13); assert.equal(result.ok,false);
});
