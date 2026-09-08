# Rates

Public exchange rates collected directly from official central bank sources. No intermediary exchange-rate API, user documents, product data, or personal data is used.

## Sources

| Provider | Central bank | Required currencies besides USD |
| --- | --- | --- |
| CBA | Armenia | AMD, EUR |
| NBRB | Belarus | BYN, EUR |
| NBG | Georgia | GEL, EUR |
| NBK | Kazakhstan | KZT, EUR |
| NBKR | Kyrgyz Republic | KGS, EUR |
| ECB | European Central Bank | EUR |
| BOM | Mongolia | MNT, EUR |
| CBR | Russia | RUB, EUR |
| CBU | Uzbekistan | UZS, AZN, EUR |

The exact official HTTPS endpoints are listed in `src/providers.mjs`. EUR comes from the selected bank, not automatically from ECB. ECB currently covers USD/EUR; NBKR covers USD/EUR/KGS. Other adapters retain their publication's available currency quotes.

## Read API

Base: `https://dellorto292-poop.github.io/Rates/v1/`

Example: `BOM/2026-09-08.json`

```json
{
  "schemaVersion": 1,
  "provider": "BOM",
  "requestedDate": "2026-09-08",
  "checkedAt": "2026-09-08T12:00:00Z",
  "ok": true,
  "rateDate": "2026-09-08",
  "rates": { "USD": 1, "MNT": 3595.64, "EUR": 0.8611403828 }
}
```

Every quote means **1 USD = X units of the target currency**. The requested date and bank publication date are distinct. Publication dates never exceed the requested date. Both legs of a cross rate come from one bank and one date; currency nominals are normalized before division. Original numerical precision is retained rather than rounded to cents. CBR's precise `VunitRate` field is supported, including scientific notation.

An unavailable or failed update returns `ok: false` without old quotes. Clients must check this flag, the schema, bank, currency, and dates. A previously published bank date may be older due to holidays or the bank's publication schedule; no automatic age cutoff is asserted. A valid format is not a guarantee against compromised publisher credentials.

The archive covers six calendar months. `manifest.json` reports actual coverage and unavailable dates. Missing history is not invented, and one bank's error does not replace another bank's data or destroy the previous internal checkpoint.

## Operations

Requires Node.js 22 or newer.

```sh
npm ci --ignore-scripts
npm test
npm run collect -- --date 2026-09-08
npm run collect:history -- --date 2026-09-08
npm run release -- --date 2026-09-08
```

`release` writes fresh `public/` and `checkpoint/` directories; it refuses to overwrite an existing output directory. Only allowlisted rate/status fields are published or persisted. Local `data/` retains fuller diagnostic information and is ignored by Git. The `codex/rates-data` branch holds a sanitized six-month checkpoint between runs, not source code.

The production workflow runs at 00:17, 06:17, 12:17 and 18:17 UTC, subject to GitHub scheduling delays. It rechecks the last three dates to capture late publications. A manual `backfill` option resumes missing history. Set repository variable `RATES_ENABLED=true` to enable the workflow; set it to `false` to pause. Public repository schedules can be disabled by GitHub after prolonged inactivity, so successful deployment and `checkedAt` still need monitoring.

## Security boundaries

- Bank requests allow only fixed official HTTPS hosts, omit credentials, reject redirects and unsafe XML, and bound response size/time. No public CORS proxy is used.
- Public responses are JSON, not executable scripts. Consumers should parse and validate data, not insert it as HTML or execute it.
- Collection runs with read-only repository permissions. A separate job validates and saves only the `codex/rates-data` branch. A separate Pages job receives deployment permissions.
- Workflow actions are pinned to full SHAs. Pull requests run tests without write permissions; they cannot trigger deployment. Production runs are restricted to this repository's `main` branch and an explicit enable switch.
- Protect the owner's account and review source/workflow changes. Public read access does not confer write access. GitHub Pages may log requesting IP addresses; this is not an anonymous service.
- Availability and future bank format compatibility are not guaranteed. A client should retain a clear manual fallback.

The collector and data publication do not require a client token. No GitHub credential belongs in a consuming HTML file.
