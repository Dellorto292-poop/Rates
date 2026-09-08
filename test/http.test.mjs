import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedUrl, createHttpClient } from '../src/http.mjs';

const url='https://api.nbrb.by/exrates/rates';
test('only official HTTPS hosts, no credentials or custom ports',()=>{
  assert.equal(allowedUrl(url),url);
  for(const invalid of ['http://api.nbrb.by','https://api.nbrb.by.evil.test','https://localhost','https://user:pass@api.nbrb.by','https://api.nbrb.by:8443']) assert.throws(()=>allowedUrl(invalid));
});
test('network cache and deduplication avoid duplicate downloads; no cookies or redirects',async()=>{
  let count=0;
  const client=createHttpClient({fetchImpl:async(_url,options)=>{count++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response('{"ok":true}')}});
  const a=await client.request(url);
  const b=await client.request(url);
  assert.equal(a,b);
  assert.equal(count,1);
  assert.match(a.sha256,/^[0-9a-f]{64}$/);
});
test('5xx retries, 4xx does not, and failed requests are not cached',async()=>{
  let count=0;
  const client=createHttpClient({sleep:async()=>{},fetchImpl:async()=>new Response('',{status:++count===1?503:200})});
  await client.request(url);
  assert.equal(count,2);
  let misses=0;
  const missing=createHttpClient({sleep:async()=>{},fetchImpl:async()=>{misses++;return new Response('',{status:404})}});
  await assert.rejects(missing.request(url),{code:'http-404'});
  await assert.rejects(missing.request(url),{code:'http-404'});
  assert.equal(misses,2);
});
test('body size is bounded',async()=>{
  const client=createHttpClient({maxBytes:4,fetchImpl:async()=>new Response('oversized')});
  await assert.rejects(client.request(url),{code:'response-too-large'});
});
test('timeout remains active while the response body stalls',async()=>{
  const client=createHttpClient({timeoutMs:20,attempts:1,fetchImpl:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new Error('aborted')))}}))});
  await assert.rejects(client.request(url),{code:'timeout'});
});
