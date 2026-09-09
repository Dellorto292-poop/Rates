import { collect } from './collect.mjs';
import { collectHistory } from './history.mjs';
import { isoDate, shiftDate } from './model.mjs';

const transient = code => ['network-error', 'timeout', 'http-429'].includes(code) || /^http-5\d\d$/.test(code || '');

export async function update({ date, outputDir, backfill = false, onResult = () => {}, collectImpl = collect, historyImpl = collectHistory, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  date = isoDate(date);
  const latest = new Map();
  const record = row => { latest.set(row.provider + '/' + row.requestedDate, row); onResult(row); };
  await historyImpl({ date, endDate: backfill ? date : shiftDate(date, -3), outputDir, onResult: record });
  const collectDay = async (requestedDate, providers) => {
    const report = await collectImpl({ date: requestedDate, outputDir, ...(providers ? { providers } : {}) });
    for (const row of report.results) record({ requestedDate, ...row });
  };
  for (let offset = 2; offset >= 0; offset--) await collectDay(shiftDate(date, -offset));
  // One delayed pass for residual transport failures. Bound the work during an
  // upstream outage; schema, date, persistence and currency errors are never retried here.
  const retry = [...latest.values()].filter(row => !row.ok && transient(row.error))
    .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate)).slice(0, 10);
  if (retry.length) await sleep(5000);
  for (const row of retry) await collectDay(row.requestedDate, [row.provider]);
  // A successful later attempt replaces an earlier transient failure, not its data.
  // Any unresolved bank/date still fails the run and publishes an explicit failure.
  return { ok: [...latest.values()].every(row => row.ok), retried: retry.length };
}
