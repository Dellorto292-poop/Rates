import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { isoDate, makeSnapshot } from '../src/model.mjs';
import { PROVIDERS, parseProvider } from '../src/providers.mjs';

// Read-only probe. It never updates collector state or follows redirects.
const date = isoDate(process.argv[2] || new Date().toISOString().slice(0, 10));
const stamp = date.slice(8) + '.' + date.slice(5, 7) + '.' + date.slice(0, 4);
async function probe(host) {
  const url = 'https://' + host + '/currencies/' + stamp + '.xml';
  const start = performance.now();
  const phases = {};
  const elapsed = () => Math.round(performance.now() - start);
  return new Promise(resolve => {
    let done = false;
    const finish = fields => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      const result = { url, ...phases, elapsedMs: elapsed(), ...fields };
      console.log(JSON.stringify(result));
      resolve(result);
    };
    const request = https.get(url, { headers: { Accept: '*/*', 'User-Agent': 'Rates/0.1' } }, response => {
      phases.headersMs = elapsed();
      if (response.statusCode !== 200) {
        response.destroy();
        finish({ ok: false, httpStatus: response.statusCode });
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) request.destroy(new Error('Diagnostic response limit exceeded'));
        else chunks.push(chunk);
      });
      response.once('error', error => finish({ ok: false, error: error.code || error.message }));
      response.once('end', () => {
        try {
          const rows = parseProvider('CBAR', Buffer.concat(chunks).toString('utf8'));
          const snapshot = makeSnapshot(PROVIDERS.CBAR, date, rows, [url], new Date().toISOString());
          finish({ ok: true, httpStatus: response.statusCode, bytes, rateDate: snapshot.rateDate, quotes: Object.keys(snapshot.rates).length });
        } catch (error) {
          finish({ ok: false, httpStatus: response.statusCode, bytes, error: error.code || 'invalid-response' });
        }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('Diagnostic deadline of 45 seconds exceeded')), 45000);
    request.on('socket', socket => {
      socket.once('lookup', error => { phases.dnsMs = elapsed(); if (error) phases.dnsError = error.code; });
      socket.once('connect', () => { phases.tcpMs = elapsed(); });
      socket.once('secureConnect', () => { phases.tlsMs = elapsed(); phases.tlsProtocol = socket.getProtocol(); });
    });
    request.once('error', error => finish({ ok: false, error: error.code || error.message }));
  });
}
const results = await Promise.all(['www.cbar.az', 'cbar.az'].map(probe));
if (!results.some(result => result.ok)) process.exitCode = 1;
