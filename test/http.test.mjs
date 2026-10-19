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
  const client=createHttpClient({fetchImpl:async(_url,options)=>{count++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');return new Response('{"ok":true}')}});
  const a=await client.request(url);
  const b=await client.request(url);
  assert.equal(a,b);
  assert.equal(count,1);
  assert.match(a.sha256,/^[0-9a-f]{64}$/);
});

test('bank redirects report their HTTP status and host without following or logging cookies and locations',async()=>{
  const nbg='https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/?date=2026-10-19';
  for(const status of [301,302,303,307,308]){
    let calls=0, cancelled=0;
    const client=createHttpClient({sleep:async()=>{},fetchImpl:async(requested,options)=>{
      calls++;
      assert.equal(requested,nbg);
      assert.equal(options.redirect,'manual');
      assert.equal(options.credentials,'omit');
      assert.equal(options.headers.Cookie,undefined);
      return new Response(new ReadableStream({cancel(){cancelled++;}}),{status,headers:{Location:'https://other.test/?secret=location-token','Set-Cookie':'secret=cookie-token'}});
    }});
    await assert.rejects(client.request(nbg),{
      code:'http-redirect',
      message:'Bank returned HTTP '+status+' redirect instead of rates (nbg.gov.ge); redirect was not followed'
    });
    assert.equal(calls,2);
    assert.equal(cancelled,2);
  }
});

test('a bank can recover after a redirect and failed redirects are not cached',async()=>{
  let calls=0;
  const client=createHttpClient({sleep:async()=>{},fetchImpl:async()=>++calls<=2?new Response('',{status:307,headers:{Location:url}}):new Response('rates')});
  await assert.rejects(client.request(url),{code:'http-redirect'});
  assert.equal((await client.request(url)).text,'rates');
  assert.equal(calls,3);
  let retries=0;
  const recovered=createHttpClient({sleep:async()=>{},fetchImpl:async()=>++retries===1?new Response('',{status:307,headers:{Location:url}}):new Response('rates')});
  assert.equal((await recovered.request(url)).text,'rates');
  assert.equal(retries,2);
});

test('HTTP 304 remains an HTTP error rather than a redirect diagnostic',async()=>{
  const client=createHttpClient({sleep:async()=>{},fetchImpl:async()=>new Response(null,{status:304})});
  await assert.rejects(client.request(url),{code:'http-304',message:'Bank returned HTTP 304'});
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
test('malformed text is not classified as a retryable connection error',async()=>{
 let calls=0;const client=createHttpClient({fetchImpl:async()=>{calls++;return new Response(new Uint8Array([0xff]));}});
 await assert.rejects(client.request(url),{code:'invalid-encoding'});assert.equal(calls,1);
});
