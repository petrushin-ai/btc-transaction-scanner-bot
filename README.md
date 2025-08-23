# BTC Transaction-scanner Bot (TypeScript) – Dockerized

Bun + TypeScript

## Prerequisites

- Bun runtime (`bun --version`) – optional for local run
- Docker (`docker --version`) – required for container run

## Run locally

```bash
bun src/index.ts
```

Or with the package script:

```bash
bun run start
```

## Environment variables

The app loads env files in this order (later overrides earlier): `.env`, `.env.local`, `.env.<env>`, `.env.<env>.local` where `<env>` is `NODE_ENV` or `APP_ENV` (default `development`).

Variables (with defaults and purpose):

- `BITCOIN_RPC_URL` (default: `http://localhost:8332`)
  - Full URL of Bitcoin Core JSON-RPC endpoint (`http(s)://host:port`).
- `BITCOIN_RPC_USER` (optional)
  - RPC username if node requires basic auth.
- `BITCOIN_RPC_PASSWORD` (optional)
  - RPC password if node requires basic auth.
- `BITCOIN_POLL_INTERVAL_MS` (default: `1000`)
  - Interval in milliseconds between checks for a new block. Lower values reduce detection latency but increase RPC load.
- `RESOLVE_INPUT_ADDRESSES` (`true|false`, default: `false`)
  - When `true`, resolves input addresses by fetching previous transactions. Enables detection of outgoing ("out") activities but increases RPC calls.
- `WATCH_ADDRESSES_FILE` (default: `./addresses.json`)
  - Path to a JSON file containing an array of `{ address, label? }` to watch. Used as the primary source.
- `WATCH_ADDRESSES` (optional)
  - CSV fallback used only if `WATCH_ADDRESSES_FILE` is missing/unreadable. Format: `address[:label],address[:label],...`.

### Logger

- `APP_ENV` or `NODE_ENV` (default: `development`)
  - Environment name; affects which `.env.*` files load and logger defaults.
- `LOG_LEVEL` (default: `debug` in `development`, otherwise `info`)
  - Log verbosity level (e.g., `trace`, `debug`, `info`, `warn`, `error`).
- `LOG_PRETTY` (`true|false`, default: `true` in `development`, otherwise `false`)
  - Pretty-print logs for human readability.
- `LOG_SERVICE_NAME` (default: `btc-transaction-scanner-bot`)
  - Service name injected into logs.

#### File output format

By default, file logs are written as a valid JSON array where every log event is appended as a new array element. This keeps `logs/output.json` (and `logs/<custom>.json`) always valid JSON that can be parsed directly. In NDJSON mode, files use the `.ndjson` extension (e.g., `logs/output.ndjson`, `logs/<custom>.ndjson`).

If you prefer newline-delimited JSON (NDJSON), pass `{ ndjson: true }` when obtaining a logger.

Examples:

```ts
import { getLogger } from "./src/infrastructure/logger";

// Default: JSON array files (logs/output.json)
const logger = getLogger();
logger.info({ hello: "world" });

// Named file with default array behavior -> logs/my-task.json
const taskLogger = getLogger({ fileName: "my-task" });
taskLogger.info({ step: 1 });

// NDJSON mode for files (writes to logs/stream.ndjson)
const ndjsonLogger = getLogger({ fileName: "stream", ndjson: true });
ndjsonLogger.info({ event: "start" });
```

### Currency

- `API_KEY_COINMARKETCAP` (required)
  - CoinMarketCap API key used by the currency provider client.
- `COINMARKETCAP_BASE_URL` (default: `https://pro-api.coinmarketcap.com`)
  - Base URL for CoinMarketCap API.
- `CUR_CACHE_VALIDITY_PERIOD` (seconds, default: `3600`)
  - Cache TTL for currency pairs; fresh network requests are skipped while cached entries are valid.

Notes:
- Currency rates are cached per provider/pair at `./cache/currency_rates.json`.
- Cache keys are namespaced by provider (e.g., `coinmarketcap`) and pair (e.g., `BTC_USDT`).

Examples:

```bash
cp .env.example .env
echo "APP_ENV=development" >> .env
echo "LOG_PRETTY=true" >> .env
echo "LOG_LEVEL=debug" >> .env
```

## Build & run with Docker

```bash
docker build -t btc-transaction-scanner-bot .
# pass envs explicitly
docker run --rm \
  -e BITCOIN_RPC_URL=http://host.docker.internal:8332 \
  -e BITCOIN_RPC_USER=rpcuser \
  -e BITCOIN_RPC_PASSWORD=rpcpass \
  -v $(pwd)/addresses.json:/app/addresses.json:ro \
  btc-transaction-scanner-bot

# or use an env file
docker run --rm --env-file .env btc-transaction-scanner-bot

## Address file format

`addresses.json` at project root (or any path via `WATCH_ADDRESSES_FILE`) contains an array of objects with `address` and optional `label`:

```json
[
  { "address": "bc1qexampleaddressxxxxxxxxxxxxxxxxxxxxxx", "label": "wallet-1" },
  { "address": "1ExampleLegacyAddressXXXXXXXXXXXXXXX", "label": "wallet-2" }
]
```
```
