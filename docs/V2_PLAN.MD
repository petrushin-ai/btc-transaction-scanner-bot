### Architecture and Domain Design

- [x] Introduce domain events and pipeline: Model a block-processing pipeline with explicit domain events (e.g., BlockDetected, BlockParsed, AddressActivityFound, NotificationEmitted) and decouple stages via an internal bus. Enables backpressure, retries, and easier profiling.
- [x] Pluggable sinks: Abstract notification sinks (stdout JSON, file, Kafka/NATS, webhook). Keep stdout as default to meet requirements; enable enterprise outputs via config.
- [ ] State management: Persist last processed height and progress markers to durable storage (e.g., file, Redis, Postgres). On restart, resume deterministically instead of let lastHeight in src/index.ts.
- [ ] Horizontal scale strategy: Partition the watched-address space across workers (consistent hashing). Add dedupe keys for events to support at-least-once delivery.
- [ ] Feature flags: Centralize feature flags with typed config (e.g., parseRawBlocks, resolveInputAddresses) and runtime-refreshable toggles.

### Block Detection and Ingestion

- [ ] Low-latency block signals: Add Bitcoin Core ZMQ subscription or getblock longpoll to reduce poll latency and RPC overhead. Keep polling as fallback with jitter.
- [ ] Backpressure-aware loop: Replace for(;;) with a queue-driven loop and bounded concurrency. Drop or delay non-critical work when lagging.

### Raw Parsing and Transaction Analysis

- [ ] Zero-copy safe parsing: The raw parser already avoids materializing strings; preserve and extend that for witness parsing and scripts. Add defensive bounds checks in ByteReader.
- [ ] Script coverage: Expand script interpreter coverage (P2SH-P2WPKH, P2TR tapscripts basics) and unify address derivation/validation in one module. Normalize Bech32 case and validate checksum centrally.
- [ ] OP_RETURN policy: Log OP_RETURN safely with size caps, UTF‑8 detection, and hex fallback. Add redaction rules for large payloads.

### Watched Address Handling

- [ ] Normalization and indexing: Normalize addresses (case rules, bech32 casing) once. Build watchSet and a labelIndex off-process at startup, expose as an immutable structure in BitcoinService.
- [ ] Efficient membership: For 1k–100k addresses, consider a Bloom filter plus exact set to cut hot-path checks.

### RPC Client and Resilience

- [ ] HTTP agent and keep-alive: Use a keep-alive agent for fetch to reduce TLS/connection overhead. Configure per-host pool limits.
- [ ] Retries with backoff: Add exponential backoff with jitter for transient RPC failures; classify common Bitcoin Core error codes (e.g., -28 warming up) for smart retry.
- [ ] Circuit breaker: Trip on sustained failures; surface degraded health; auto-recover with half-open probes.
- [ ] Batching and pooling: Generalize batch calls and add a concurrency limiter per method. Ensure getRawTransactionVerboseBatch exists and is used where appropriate.
- [ ] Type correctness: Fix BitcoinRpcClientOptions to include username (it’s used in the constructor). Strongly type request/response shapes and error envelopes.
- [ ] Timeouts per call: Differentiate timeouts for getblockcount, getblockhash, getblock, getrawtransaction, tuned by payload size.

### Currency Rates and USD Computation

- [ ] Provider abstraction: Keep CoinMarketCapClient, add secondary providers (e.g., CoinGecko) with weighted fallback. Fail open with stale-cache grace period and explicit “stale” flag.
- [ ] Cache strategy: Maintain in-memory hot cache and file cache; add TTL jitter, negative caching on 4xx/5xx, and circuit breaker on provider errors.
- [ ] Precision: Use decimal math (e.g., big.js) for rate × amount, with consistent rounding policy and currency formatting.

### Observability and Operability

- [ ] Metrics (Prometheus/OpenTelemetry): Export histograms and counters: RPC latency by method, block detection lag, parse duration, matched addresses per block, queue depth, retries, currency fetches.
- [ ] Structured event schemas: Versioned JSON schemas for emitted notifications; validate pre-emit. Include correlation IDs: blockHash, height, txid, eventId.
- [ ] Logging strategy: Prefer NDJSON for files by default with logrotate-friendly outputs; keep pretty console in dev. The JSON-array file writer in src/infrastructure/logger is unusual—offer it as optional mode only.
- [ ] Production log gating: Keep current gating but enforce by logger config, not ad-hoc type checks. Add sample rate for noisy debug streams.
- [ ] Tracing: Add spans around block fetch, parse, address match, USD enrichment, and emit.

### Configuration and Secrets

- [ ] Typed config: Continue Ajv (or migrate to Zod) with inferred TS types. Emit friendly validation errors with actionable tips.
- [ ] Secrets and TLS: Support RPC over TLS with CA pinning and client certs. Source credentials from env/secret store, ensure they are never logged.
- [ ] Hot-reload watch list: Watch addresses.json file with debounce and atomic swap of the in-memory structure.

### Reliability and Shutdown

- [ ] Graceful shutdown: Handle SIGINT/SIGTERM; flush logs, persist last processed height, drain queues, close HTTP agents.
- [ ] Idempotency: Use deterministic eventId to dedupe downstream. Emit “block reorg” compensating events on chain rollbacks.

### Performance and Scalability

- [ ] Concurrency controls: Tune parallel RPC calls with a token bucket limiter; batch prev-tx fetches; cap batch size by payload.
- [ ] Memory discipline: Cap previous transaction cache and expose metrics; avoid unbounded maps. Reuse buffers where possible.
- [ ] Profiling: Add CPU and heap profiling hooks. Include perf baselines in CI (parse N blocks, 7 TPS scenario, 1k addresses).

### Testing and Quality

- [ ] Property/fuzz tests: For raw parser and script decoder with randomly generated but valid structures.
- [ ] Golden fixtures: Maintain canonical blocks/tx fixtures and expected activities; protect against regressions.
- [ ] Failure injection: Tests for RPC timeouts, partial batches, stale rates, reorgs, provider outages.
- [ ] Soak tests: Long-running test under 7 TPS and 1k addresses; assert memory ceiling and steady latency.
- [ ] Schema contract tests: Validate emitted notification JSON against schema across test suite.

### Security

- [ ] Input validation: Strict bounds and type checks in parsers; cap OP_RETURN logging; sanitize labels loaded from files.
- [ ] Dependency hygiene: Lockfile integrity, vulnerability scanning, minimal image surface (distroless or slim), run as non-root.

### Packaging and Deployment

- [ ] Docker hardening: Multi-stage build, non-root user, read-only FS where possible, healthcheck command wired to scripts/healthcheck.ts.
- [ ] Configurable resources: Document CPU/memory requests/limits, and tune Bun GC if applicable.
- [ ] CI/CD: Lint, typecheck, unit/integration tests, security scan, image build, and smoke tests. Publish SBOM and provenance.

### Documentation and DX

- [ ] Architectural runbook: Sequence diagrams for block flow; troubleshooting guide for common RPC errors.
- [ ] Operational playbooks: Reorg handling, provider failover, cache staleness, and scaling out addresses.
- [ ] Clear JSON examples: Versioned samples for all event types, with notes on fields and units.

### Targeted Changes

- [ ] In src/index.ts, persist the last processed height and add signal handling.
- [ ] In src/application/services/BitcoinService.ts, add longpoll/ZMQ support, backpressure, and refined logging with correlation IDs.
- [ ] In src/infrastructure/bitcoin/BitcoinRpcClient.ts, add keep-alive agent, retry/backoff, circuit breaker, stricter typing, and method-level timeouts.
- [ ] In src/infrastructure/logger/Logger.ts, make NDJSON the default and support rotation; keep JSON-array as optional mode.
- [ ] In src/application/services/CurrencyService.ts, add provider fallback, stale-cache grace, precision math, and metrics.
- [ ] In src/config, strengthen env schema, add hot-reload for watch list, and generate TS types from the schema.

### Summary

Prioritized upgrades to resilience, observability, and performance while preserving raw parsing and no-explorer constraints.

Concrete targets: ZMQ/longpoll for latency, RPC client with retries/circuit breaker, NDJSON logging + metrics, durable progress state, provider fallback, and robust tests for reorgs and failures.