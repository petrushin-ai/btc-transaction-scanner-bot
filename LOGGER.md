## Logger

Comprehensive guide to the application logger located at `src/infrastructure/logger/Logger.ts` and its helpers in `src/infrastructure/logger/helpers.ts`.

### What you get

- **Multi-destination logging**: always to stdout and to files under `logs/`.
- **Human-friendly console**: pretty printing in development when `LOG_PRETTY=true`.
- **Two file formats**:
  - **JSON array** (default): `logs/output.json` and `logs/<name>.json` remain valid arrays at all times.
  - **NDJSON** (opt-in): one JSON object per line using `.ndjson` extension.
- **Safe defaults via env**: level, service name, formatting, and env detection.
- **Sensitive fields redaction**: passwords, tokens, secrets, and `req.headers.authorization`.
- **Callable logger API**: a default logger you can use directly, and the same function can be called to obtain named or NDJSON loggers.
- **Instance caching**: repeated calls with the same options return the same underlying logger instance.

## Quick start

```ts
import { logger } from "./src/infrastructure/logger";

// 1) Use the default logger (writes to stdout + logs/output.json)
logger.info({ event: "app_started" }, "Application started");

// 2) Create a named file logger (adds logs/my-task.json)
const taskLog = logger({ fileName: "my-task" });
taskLog.debug({ step: 1 }, "Preparing task");

// 3) NDJSON file logger (adds logs/stream.ndjson)
const streamLog = logger({ fileName: "stream", ndjson: true });
streamLog.info({ phase: "start" });
```

Notes:
- Import path may differ depending on where you call it from; the index exports are at `src/infrastructure/logger/index.ts`.
- The logger is backed by `pino`. All standard Pino methods are available: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

## API

- **Default callable**: `logger: ((arg?: string | { fileName?: string; ndjson?: boolean }) => AppLogger) & AppLogger`
  - As a function:
    - `logger()` → default logger (files: `logs/output.json` or `logs/output.ndjson` depending on mode; default is JSON array)
    - `logger("my-file")` → named JSON-array file at `logs/my-file.json`
    - `logger({ fileName: "my-file", ndjson: true })` → named NDJSON file at `logs/my-file.ndjson`
  - As an object: call methods directly, e.g., `logger.info(...)` uses the default logger instance.

### Caching behavior

The logger caches instances by `(fileName || "__default__", ndjson)`. Calling `logger({ fileName: "x" })` repeatedly returns the same instance. This avoids duplicate file streams and improves performance.

## Configuration

Environment variables (loaded from `.env`, `.env.local`, `.env.<env>`, `.env.<env>.local`):

- **APP_ENV / NODE_ENV**: environment name; default `development`.
- **LOG_LEVEL**: Pino level. Default: `debug` in development, otherwise `info`.
- **LOG_PRETTY**: `true|false`. Pretty console output. Default: `true` in development, `false` otherwise.
- **LOG_SERVICE_NAME**: service name added to logs. Default: `btc-transaction-scanner-bot`.

Env files are searched from the nearest project root (directory containing `package.json` or any `.env*`), walking upward from `process.cwd()`.

## Destinations and file layout

- **Stdout**: always enabled. Pretty formatting honors `LOG_PRETTY`.
- **Files**: under `<projectRoot>/logs` where `projectRoot` is the nearest directory containing `package.json`.
  - Default file: `logs/output.json` (or `logs/output.ndjson` when NDJSON mode is selected).
  - Named file: `logs/<name>.json` (or `.ndjson`). The `fileName` is normalized: passing `my-log`, `my-log.json`, or `my-log.ndjson` will result in the correct extension for the chosen mode.

### File formats

- **JSON array (default)**
  - The file is always a valid JSON array. Each log event is appended before the closing `]` and separated by commas and newlines.
  - Safe in case of crashes; the file remains parseable with `JSON.parse`.
  - Example content (`logs/output.json`):

```json
[
  { "level": "info", "time": "2024-01-01T10:00:00.000Z", "service": "btc-transaction-scanner-bot", "env": "development", "msg": "Application started" }
]
```

- **NDJSON (opt-in)**
  - One JSON object per line, suitable for streaming and line-oriented tools.
  - Example lines (`logs/output.ndjson`):

```ndjson
{"level":"info","time":"2024-01-01T10:00:00.000Z","service":"btc-transaction-scanner-bot","env":"development","msg":"Application started"}
{"level":"debug","time":"2024-01-01T10:00:01.000Z","service":"btc-transaction-scanner-bot","env":"development","msg":"Prepared"}
```

## Log record shape

The logger config augments Pino records with:

- **timestamp**: ISO time via `pino.stdTimeFunctions.isoTime`.
- **level**: exposed as `{"level": "info"}`.
- **message**: stored under `msg`.
- **base fields**: `{ service: LOG_SERVICE_NAME, env: APP_ENV/NODE_ENV, pid, hostname }`.
- **redaction**: values under keys like `*.password`, `*.apiKey`, `*.token`, `*.secret`, and `req.headers.authorization` are replaced with `"[*****]"`.

Example console (pretty):

```text
INFO  2024-01-01T10:00:00.000Z Application started
      service=btc-transaction-scanner-bot env=development
```

## Operational notes

- **Synchronous vs asynchronous file writes**
  - NDJSON files use Pino destinations. In development they are opened with synchronous writes for simplicity; in other environments they use Pino's default (asynchronous) behavior.
  - JSON-array files use a small custom writable stream that ensures the file stays a valid JSON array; it uses synchronous writes for correctness.

- **Rotation**
  - Built-in rotation is not provided. Use external tools (Docker log driver, logrotate, cloud collectors) if you need rotation or shipping.

## Usage patterns and tips

- **Per-task files**: use `logger({ fileName: "reindex" })` to keep a dedicated trace for long-running tasks.
- **Switching formats**: prefer default JSON arrays for easy `JSON.parse`. Use NDJSON when integrating with line-oriented log pipelines.
- **Parsing**:
  - JSON array: `const events = JSON.parse(fs.readFileSync("logs/output.json", "utf8"));`
  - NDJSON: `fs.readFileSync("logs/output.ndjson", "utf8").trim().split(/\n+/).map(JSON.parse)`.

## FAQ

- **Q: How do I change the console to pretty JSON?**
  - Set `LOG_PRETTY=true` (typically in development). Pretty output is for stdout only; files remain machine-friendly (array or NDJSON).

- **Q: Can I disable stdout or file logging?**
  - Not at the moment. The logger is configured to always write to stdout and to files. If you need toggles, we can extend the options.

- **Q: How do I add more base fields to every log?**
  - Wrap the logger and inject your fields: `const appLog = logger(); const child = appLog.child({ subsystem: "scanner" }); child.info("started");`.

- **Q: Is `fileName` required?**
  - No. Without it, only `logs/output.json` (or `.ndjson`) is used in addition to stdout.

## Related code

- `src/infrastructure/logger/Logger.ts` – constructs the logger, destinations, and exports the callable `logger`.
- `src/infrastructure/logger/helpers.ts` – env resolution, file utilities, JSON-array destination, pretty stdout, and callable helper.
- `src/config/env.ts` – `.env*` loading order and base directory detection.

## Example configuration

```bash
echo "APP_ENV=development" >> .env
echo "LOG_PRETTY=true" >> .env
echo "LOG_LEVEL=debug" >> .env
echo "LOG_SERVICE_NAME=btc-transaction-scanner-bot" >> .env
```


