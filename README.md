# BTC Transaction-scanner Bot (TypeScript) 

Assesment job - Bun + TypeScript

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

- `BTC_RPC_API_URL` (default: `http://localhost:8332`)
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
  - Path to a JSON file containing an array of `{ address, label? }` to watch. Used as the primary source. Loaded via `FileStorageService`.
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
import { getFileStorage } from "./src/infrastructure";

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

### File storage abstraction

All filesystem interactions are routed through `FileStorageService` to keep IO concerns decoupled.

- Logger file destinations use the storage abstraction for safe array-JSON writes.
- Currency cache (`cache/currency_rates.json`) reads/writes via the storage service.
- Config address loading (`WATCH_ADDRESSES_FILE`) uses the storage service.

You can access the default implementation via:

```ts
import { getFileStorage } from "./src/infrastructure";

const storage = getFileStorage();
if (storage.fileExists("addresses.json")) {
  const json = JSON.parse(storage.readFile("addresses.json", "utf-8"));
}
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
  -e BTC_RPC_API_URL=http://host.docker.internal:8332 \
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

## Testing

The project uses Bun's built-in test runner. Performance, latency, and scalability are validated via tests under `tests/`.

Run the full suite (pretty metrics summary will be printed at the end):

```bash
bun test
```

Watch mode:

```bash
bun test --watch
```

What is covered:

- Raw block parsing performance (time and memory delta)
- Transaction matching time with 1000 watched addresses
- Block discovery → processing latency (target ≤ 5s)
- Scalability: supports 1000 concurrent addresses and sustained 7 TPS

Pretty metrics summary example:

```text
Metrics Summary (5 metrics)

  latency
    block_discovery_to_processing_ms => 203 ms

  matching
    check_1000_addresses_ms => 2 ms  [activities=0]

  raw-parser
    mem_delta_mb => 33.8 MB
    parse_block_ms => 20 ms  [txCount=1342]

  scalability
    process_7tps_10s_total_ms => 59 ms  [totalActivities=70]
```

CI-friendly JUnit report (optional):

```bash
bun test --reporter=junit --reporter-outfile=bun.xml
```

Bun test docs: https://bun.com/docs/cli/test
```

### Docker Compose (recommended)

Compose will proxy variables from your local `.env` file into the container automatically.

Prod-like run:

```bash
bun run docker:up
# tail logs
bun run docker:logs
# stop
bun run docker:down
```

Dev run with live reload (mounts project, runs `bun --watch src/index.ts`):

```bash
bun run docker:dev:up
# stop
bun run docker:dev:down
```

Service name in Compose is `btc-transaction-scanner-bot`.

Compose proxies these env vars from `.env`:

- `APP_ENV`
- `BTC_RPC_API_URL`
- `BITCOIN_POLL_INTERVAL_MS`
- `RESOLVE_INPUT_ADDRESSES`
- `CUR_CACHE_VALIDITY_PERIOD`
- `COINMARKETCAP_BASE_URL`
- `API_KEY_COINMARKETCAP`
- `PARSE_RAW_BLOCKS`
  
## Providers

- Bitcoin RPC provider: QuickNode — see their developer center at `https://www.quicknode.com/docs/developer-center`. Any Bitcoin Core–compatible RPC endpoint is supported; set `BTC_RPC_API_URL` accordingly.
- Currency rates: CoinMarketCap API — documentation at `https://coinmarketcap.com/api/documentation/v1/`. Provide `API_KEY_COINMARKETCAP` to enable USD equity.

Notes on rates caching:
- Rates are cached per provider/pair under `./cache/currency_rates.json` and controlled by `CUR_CACHE_VALIDITY_PERIOD`.
- A single BTC→USD rate is fetched per processed block and reused for all activities in that block.

## JSON Notification Format

The bot emits structured JSON events to stdout (and files). Production mode hides noisy debug entries; info-level activity notifications are always emitted.

- Block summary (debug-level):

```json
{
  "type": "block.activities",
  "blockHeight": 834000,
  "blockHash": "000000...",
  "txCount": 1342,
  "activityCount": 3
}
```

- Address activity (info-level):

```json
{
  "type": "transaction.activity",
  "blockHeight": 834000,
  "blockHash": "000000...",
  "txid": "abc123...",
  "address": "bc1q...",
  "label": "wallet-1",
  "direction": "in",
  "valueBtc": 0.01234567,
  "valueUsd": 882.34,
  "opReturnHex": "48656c6c6f20576f726c64",
  "opReturnUtf8": "Hello World"
}
```

- OP_RETURN (debug-level, when present):

```json
{
  "type": "transaction.op_return",
  "blockHeight": 834000,
  "blockHash": "000000...",
  "txid": "abc123...",
  "opReturnHex": "48656c6c6f20576f726c64",
  "opReturnUtf8": "Hello World"
}
```

Notes:
- When both incoming and outgoing operations exist for the same address within a tx, the bot emits the net difference as a single event with `direction` set accordingly and `valueBtc` equal to the absolute net.
- Outgoing/net detection requires `RESOLVE_INPUT_ADDRESSES=true`.

## Raw block parsing and script interpretation

- Enable via `PARSE_RAW_BLOCKS=true`.
- Raw path fetches hex with `getblock(hash, 0)` and parses using our custom modules:
  - `src/infrastructure/bitcoin/raw/ByteReader.ts` – buffered reader and helpers
  - `src/infrastructure/bitcoin/raw/Address.ts` – Base58Check and Bech32/Bech32m encoders, network versions
  - `src/infrastructure/bitcoin/raw/Script.ts` – script classification and address derivation
  - `src/infrastructure/bitcoin/raw/TxParser.ts` – SegWit-aware transaction parser; computes `txid` per BIP-0141
  - `src/infrastructure/bitcoin/raw/BlockParser.ts` – parses block header and transactions

Supported script types:
- `pubkeyhash` (P2PKH)
- `scripthash` (P2SH)
- `witness_v0_keyhash` (P2WPKH)
- `witness_v0_scripthash` (P2WSH)
- `witness_v1_taproot` (P2TR)
- `nulldata` (OP_RETURN) – extracts payload hex and best‑effort UTF‑8

Network is detected from `getblockchaininfo.chain` and passed into address encoding.

## USD equity calculation

- Provide `API_KEY_COINMARKETCAP` to enable USD amounts (`valueUsd`).
- A single BTC→USD rate per processed block is fetched and cached, then applied to all activities in that block.

## Assessment compliance mapping

- Core Requirements
  - Configuration of addresses and names: `WATCH_ADDRESSES_FILE` (JSON array) or fallback `WATCH_ADDRESSES` CSV. See `src/config/index.ts`.
  - Post new transactions and info (from/to, amount, USD, tx hash): JSON `transaction.activity` logs with `address`, `direction`, `valueBtc`, `valueUsd`, `txid`.
  - Technical requirements compliance: validated by tests in `tests/` with metrics summary.
- Transaction Notifications
  - JSON logs to stdout and files; USD equity included when currency service configured.
  - Mixed in/out operations per tx are netted to a single event.
- Raw Data Processing
  - Direct raw block parsing (`PARSE_RAW_BLOCKS=true`) with custom script interpretation; supports legacy and SegWit, OP_RETURN parsing.
- Technical Requirements
  - Performance: latency ≤ 5s (see `tests/latency.notification.test.ts`); bounded memory and fast raw parsing (see perf tests).
  - Scalability: ≥1000 addresses matching and sustained 7 TPS (see `tests/perf.matching-1000.test.ts`, `tests/scalability.tps-7.test.ts`).
- Restrictions
  - No explorer APIs; only Bitcoin Core-compatible RPC is used.

## Architecture (high level)

- Clean layering:
  - `src/types` – domain types and interfaces
  - `src/application` – services (`BitcoinService`, `CurrencyService`, `HealthCheckService`) and helpers
  - `src/infrastructure` – RPC client, logger, storage, currency client, raw parser
  - `src/config` – env loading and validation
- Flow per block: load config → await new block → parse (raw or verbose) → match watched addresses → annotate with USD → emit JSON notifications.

## Operational notes

- Production mode suppresses debug-level noisy logs (poll/summary/OP_RETURN) on stdout; `transaction.activity` stays at info.
- File logs are always written and remain valid JSON arrays by default. NDJSON is available.
- For net/outgoing detection, enable `RESOLVE_INPUT_ADDRESSES=true`.

## Quick start (recap)

```bash
cp .env.example .env || true
echo "APP_ENV=development" >> .env
echo "BTC_RPC_API_URL=http://localhost:8332" >> .env
# Optional flags:
# echo "PARSE_RAW_BLOCKS=true" >> .env
# echo "RESOLVE_INPUT_ADDRESSES=true" >> .env

bun run start
```
