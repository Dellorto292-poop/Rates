import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collect } from '../src/collect.mjs';
import { observation, RateError } from '../src/model.mjs';

const today='2026-09-08';
const now=()=>today+'T15:00:00Z';
const bank=async (id,date)=>({observations:[observation(date,'USD',id==='ECB'?1.16:3595),...(id==='ECB'?[]:[observation(date,'EUR',4175)])],sources:['https://www.mongolbank.mn/en/currency-rate-movement/data']});
async function cleanup(dir) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
  assert.match(path.basename(dir), /^fx-test-/);
  await rm(dir, {recursive:true,force:true});
}
test('one bank failure preserves saved rates and other banks continue',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'fx-test-'));
  try{
    const options={date:today,providers:['BOM','ECB'],outputDir:dir,now};
    await collect({...options,fetchBank:bank});
    const file=path.join(dir,'banks/BOM/'+today+'.json');
    const old=await readFile(file,'utf8');
    const report=await collect({...options,fetchBank:async(id,date)=>{if(id==='BOM')throw new RateError('timeout','Timeout');return bank(id,date)}});
    assert.deepEqual(report.results.map(r=>r.ok),[false,true]);
    assert.equal(await readFile(file,'utf8'),old);
    const status=JSON.parse(await readFile(path.join(dir,'status/BOM/'+today+'.json'),'utf8'));
    assert.equal(status.error,'timeout');
  }finally{await cleanup(dir)}
});
test('historical collection does not roll latest backwards; stale replacement is rejected',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'fx-test-'));
  try{
    const options={date:today,providers:['BOM'],outputDir:dir,now,fetchBank:bank};
    await collect(options);
    const latest=await readFile(path.join(dir,'banks/BOM/latest.json'),'utf8');
    await collect({...options,date:'2026-09-01'});
    assert.equal(await readFile(path.join(dir,'banks/BOM/latest.json'),'utf8'),latest);
    const report=await collect({...options,fetchBank:(id)=>bank(id,'2026-09-02')});
    assert.equal(report.results[0].error,'stale-response');
    assert.equal(await readFile(path.join(dir,'banks/BOM/latest.json'),'utf8'),latest);
  }finally{await cleanup(dir)}
});
test('unknown providers and future request dates are rejected before network or writes',async()=>{
  await assert.rejects(collect({date:today,providers:['../../x'],outputDir:'unused',now}),{code:'unsupported-provider'});
  await assert.rejects(collect({date:today,providers:['constructor'],outputDir:'unused',now}),{code:'unsupported-provider'});
  await assert.rejects(collect({date:'2026-09-09',providers:['BOM'],outputDir:'unused',now}),{code:'future-request'});
});
test('overlapping runs are rejected without removing the first run lock',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'fx-test-'));
  let release;
  let entered;
  const started=new Promise(resolve=>{entered=resolve});
  const pause=new Promise(resolve=>{release=resolve});
  const options={date:today,providers:['ECB'],outputDir:dir,now};
  const first=collect({...options,fetchBank:async(id,date)=>{entered();await pause;return bank(id,date)}});
  try{
    await started;
    await assert.rejects(collect({...options,fetchBank:bank}),{code:'EEXIST'});
    assert.ok(await readFile(path.join(dir,'.collect.lock'),'utf8'));
  }finally{release();await first;await cleanup(dir)}
});
