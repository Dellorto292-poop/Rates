import { createHash } from 'node:crypto';
import { RateError } from './model.mjs';

export const BANK_HOSTS = new Set([
  'www.cbar.az', 'api.cba.am', 'api.nbrb.by', 'nbg.gov.ge', 'nationalbank.kz',
  'www.nbkr.kg', 'data-api.ecb.europa.eu', 'www.mongolbank.mn', 'www.cbr.ru', 'cbu.uz'
]);

export function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !BANK_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new RateError('blocked-url', 'Only allowlisted official HTTPS bank endpoints are permitted');
  }
  return url.href;
}

export function createHttpClient({ fetchImpl = fetch, timeoutMs = 30000, maxBytes = 12 * 1024 * 1024, attempts = 2, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const completed = new Map();
  const pending = new Map();
  async function download(url, options) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      // Keep the deadline active through body consumption, not just response headers.
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: options.method || 'GET', body: options.body,
          headers: { Accept: '*/*', 'User-Agent': 'Rates/0.1', ...options.headers },
          credentials: 'omit', redirect: 'error', signal: controller.signal
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new RateError('http-' + response.status, 'Bank returned HTTP ' + response.status);
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new RateError('response-too-large', 'Bank response exceeds size limit');
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const buffer = Buffer.concat(chunks);
        const text = new TextDecoder(options.encoding || 'utf-8', { fatal: true }).decode(buffer);
        return { text, url, sha256: createHash('sha256').update(buffer).digest('hex'), bytes: size };
      } catch (error) {
        lastError = error instanceof RateError ? error : new RateError(controller.signal.aborted ? 'timeout' : 'network-error', 'Official bank request failed');
        if (lastError.code === 'response-too-large' || /^http-4/.test(lastError.code) && lastError.code !== 'http-429') break;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt + 1 < attempts) await sleep(500 * (attempt + 1));
    }
    throw lastError;
  }
  return {
    async request(value, options = {}) {
      const url = allowedUrl(value);
      const key = JSON.stringify([url, options.method, options.body, options.encoding, options.headers]);
      if (completed.has(key)) return completed.get(key);
      if (!pending.has(key)) pending.set(key, download(url, options));
      try {
        const result = await pending.get(key);
        completed.set(key, result);
        return result;
      } finally {
        pending.delete(key);
      }
    }
  };
}
