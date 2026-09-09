# Rates

Official central-bank exchange rates, normalized as **currency units per 1 USD**. No commercial FX aggregator and no silent substitution between banks.

Supported banks: CBAR (Azerbaijan), CBA (Armenia), NBRB (Belarus), NBG (Georgia), NBK (Kazakhstan), NBKR (Kyrgyzstan), ECB, BOM (Mongolia), CBR (Russia), CBU (Uzbekistan).

## Public contract

`https://dellorto292-poop.github.io/Rates/v2/{BANK}/{YYYY-MM-DD}.json`

Successful responses contain `schemaVersion: 2`, `provider`, `requestedDate`, `checkedAt`, `ok: true`, `rateDate`, `rates`, `rateDates`, and `frequencies`. The last three are maps keyed by currency. `rateDate` is the primary daily publication date; use **`rateDates[currency]`** for the selected currency. `frequencies[currency]` is `daily`, `weekly`, or `monthly`. `requestedDate` is a lookup date, never proof that a quote was established that day. `checkedAt` is collection time.

An unavailable bank/date returns `ok: false` without rates. A missing currency is unavailable from that bank; clients must not silently substitute another bank. The rolling archive covers six calendar months.

`/v1/` retains its previous strict JSON shape and only daily quotes from its one stated date, for existing clients. `/v2/` adds periodic coverage without mislabeling it in older applications.

## Sources and date semantics

| Bank | Official source | Collection |
| --- | --- | --- |
| CBAR | [Dated XML](https://www.cbar.az/currencies/09.09.2026.xml) | Currency attributes, nominal, actual XML effective date; holiday requests may return an earlier publication. No browser CORS is required by the server collector. |
| CBA | [SOAP API](https://api.cba.am/exchangerates.asmx) | All published currencies, amount/nominal and response date. |
| NBRB | [API documentation](https://www.nb-rb.by/apihelp/exrates.htm) | Daily (`periodicity=0`) and monthly (`periodicity=1`) series. Monthly values are requested on the first of the applicable month. |
| NBG | [Dated API](https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/?date=2026-09-09) | All published currencies and their quantities. |
| NBK | [Dated XML](https://nationalbank.kz/rss/get_rates.cfm?fdate=09.09.2026) | All published currencies and nominals. |
| NBKR | [Official archive and frequency rules](https://www.nbkr.kg/index1.jsp?item=1562&lang=ENG&valuta_id=15) | USD, EUR, RUB, KZT, CNY daily; other current quoted currencies weekly. Historical bank IDs and nominals are explicit in `src/providers.mjs`. Retired BYR and obsolete archive IDs are excluded. |
| ECB | [SDMX API](https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?startPeriod=2026-09-08&endPeriod=2026-09-08&format=jsondata) | All daily reference currencies; native EUR is added as the pivot. |
| BOM | [Official archive](https://www.mongolbank.mn/en/currency-rate-movement) | All published current currency fields in the bounded date window. |
| CBR | [Dated XML](https://www.cbr.ru/scripts/XML_daily.asp?date_req=09/09/2026) | All published currencies; precise per-unit field where supplied. |
| CBU | [Dated API](https://cbu.uz/en/arkhiv-kursov-valyut/json/all/2026-09-09/) | All published currencies and nominals. |

Different banks publish different currency lists and may publish different rates. The resulting bank/currency coverage is intentionally uneven. Selecting a bank does not make absent currencies available. Precious metals are excluded where identified by the adapters; SDR is normalized to the standard `XDR` code.

Both legs of each USD cross use the **same bank and the same effective date**. For example, a weekly AMD/KGS quote effective September 5 is converted using that bank's USD/KGS value effective September 5, even when requested September 9. Its result is still labeled September 5, weekly. Monthly crosses analogously use the first-of-month USD leg. These are calculated USD crosses of official quotes, not a claim that a bank directly publishes every USD pair. Weekly quotes expire after their seven-day validity window; monthly quotes do not carry into another month. No future-dated live feed is used as historical data.

## Maintenance

Review source coverage **at least every six months**. Last source review: **2026-09-09**. Next review due: **2027-03-09**.

1. Compare each official currency list with collected output, including daily/weekly/monthly distinctions, retired and newly introduced currencies.
2. Verify bank archive IDs, nominals, decimal formats, effective dates, holidays, and same-date USD anchors. Update NBKR mappings when the bank changes them.
3. Exercise live sources and all bank/currency combinations through the client; unavailable combinations must remain explicit.
4. Update fixtures and documentation. Increase the provider's `coverageVersion` when historic output needs recollection; automatic archive repair revisits outdated snapshots.
5. Run `npm test`, the manual **Bank source smoke test**, and **Update Rates**; check collection, checkpoint, deployment, and `bank-health`, then inspect both API versions.

`npm run collect -- --date YYYY-MM-DD --providers CBAR,NBKR --output /path/to/data` runs a bounded collection. Scheduled production updates keep sanitized state on `codex/rates-data`; raw source observations/URLs never enter the public response. Publishing and state persistence use separate least-privilege jobs.
