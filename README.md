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

Required/optional variables:

- `BITCOIN_RPC_URL` (default: `http://localhost:8332`)
- `BITCOIN_RPC_USER`
- `BITCOIN_RPC_PASSWORD`
- `BITCOIN_POLL_INTERVAL_MS` (default: `1000`)
- `RESOLVE_INPUT_ADDRESSES` (`true|false`, default: `false`)
- `WATCH_ADDRESSES` CSV `address[:label],...` (fallback if file missing)
- `WATCH_ADDRESSES_FILE` path to JSON file (default: `./addresses.json`)

### Logger

- `APP_ENV` or `NODE_ENV` (default: `development`) – influences defaults
- `LOG_LEVEL` (default: `debug` in dev, `info` otherwise)
- `LOG_PRETTY` (`true|false`, default: `true` in dev, `false` otherwise)
- `LOG_SERVICE_NAME` (default: `btc-transaction-scanner-bot`)

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
