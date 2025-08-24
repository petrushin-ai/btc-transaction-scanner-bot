### Architecture and Domain Design

- [x] Introduce domain events and pipeline: Model a block-processing pipeline with explicit domain events (e.g., BlockDetected, BlockParsed, AddressActivityFound, NotificationEmitted) and decouple stages via an internal bus. Enables backpressure, retries, and easier profiling.
- [x] Pluggable sinks: Abstract notification sinks (stdout JSON, file, Kafka/NATS, webhook). Keep stdout as default to meet requirements; enable enterprise outputs via config.
- [x] Horizontal scale strategy: Partition the watched-address space across workers (consistent hashing). Add dedupe keys for events to support at-least-once delivery.
- [x] Feature flags: Centralize feature flags with typed config (e.g., parseRawBlocks, resolveInputAddresses) and runtime-refreshable toggles.

### Block Detection and Ingestion

- [x] Backpressure-aware loop: Replace for(;;) with a queue-driven loop and bounded concurrency. Delay non-critical work when lagging.

### Raw Parsing and Transaction Analysis

- [x] Zero-copy safe parsing: The raw parser already avoids materializing strings; preserve and extend that for witness parsing and scripts. Add defensive bounds checks in ByteReader.
- [x] Script coverage: Expand script interpreter coverage (P2SH-P2WPKH, P2TR tapscripts basics) and unify address derivation/validation in one module. Normalize Bech32 case and validate checksum centrally.
- [x] OP_RETURN policy: Log OP_RETURN safely with size caps, UTF‑8 detection, and hex fallback. Add redaction rules for large payloads.

### Watched Address Handling

- [x] Normalization and indexing: Normalize addresses (case rules, bech32 casing) once. Build watchSet and a labelIndex off-process at startup, expose as an immutable structure in BitcoinService.

### RPC Client and Resilience

- [x] HTTP agent and keep-alive: Use a keep-alive agent for fetch to reduce TLS/connection overhead. Configure per-host pool limits.

### Currency Rates and USD Computation

- [x] Cache strategy: Maintain in-memory hot cache and file cache; add TTL jitter, negative caching on 4xx/5xx, and circuit breaker on provider errors.
- [x] Precision: Use decimal math (e.g., big.js) for rate × amount, with consistent rounding policy and currency formatting.

### Observability and Operability

- [X] Logging strategy: Prefer NDJSON for files by default with logrotate-friendly outputs; keep pretty console in dev.

### Configuration improvements

- [x] Typed config: Migrate to Zod from Ajv with inferred TS types. Emit friendly validation errors with actionable tips.

### Watchlist hot reload
- [x] Hot-reload watch list: Watch addresses.json file with debounce and atomic swap of the in-memory structure.

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