## Architectural Runbook

This document explains how a Bitcoin block flows through the system and how services interact with infrastructure and external providers.

### Block flow (sequence)

```mermaid
sequenceDiagram
  participant Index as main()
  participant EventBus as EventService
  participant BTC as BitcoinService
  participant RPC as BitcoinRpcClient (QuickNode)
  participant Pipeline as Pipeline Subscribers
  participant Currency as CurrencyService
  participant Rates as CoinMarketCapClient
  participant Sinks as Sinks (stdout/file/webhook/kafka/nats)

  Index->>BTC: awaitNewBlock(lastHeight)
  BTC->>RPC: getblockhash/getblock
  RPC-->>BTC: block header/hex
  BTC-->>Index: ParsedBlock {height, hash, prevHash}
  Index->>EventBus: publish BlockDetected

  EventBus->>Pipeline: parse-block handler
  Pipeline->>BTC: parseBlockByHash(hash)
  BTC->>RPC: getblock(hash, raw/verbose)
  RPC-->>BTC: block data
  BTC-->>Pipeline: ParsedBlock
  Pipeline->>EventBus: publish BlockParsed

  EventBus->>Pipeline: compute-activities handler
  Pipeline->>BTC: checkTransactions(block, watch)
  BTC-->>Pipeline: AddressActivity[]
  Pipeline->>Currency: getUsdRate()
  Currency->>Rates: quotes (BTC → USD)
  Rates-->>Currency: rate
  Currency-->>Pipeline: rate
  Pipeline->>Pipeline: mapActivitiesWithUsd()
  Pipeline->>EventBus: publish AddressActivityFound (per activity)

  EventBus->>Pipeline: log-activity handler
  Pipeline->>Sinks: send(ev) to enabled sinks
  Sinks-->>Pipeline: results (settled)
  Pipeline->>EventBus: publish NotificationEmitted

  Note over Index,BTC: Reorg detection: when prevHash mismatch
  Index->>EventBus: publish BlockReorg
```

Key notes:

- Timestamps are ISO-8601 strings on events; `block.time` is UNIX seconds.
- Backpressure uses the event bus queue; parsing and OP_RETURN logging may be delayed when backlog is high.
- Each event includes a deterministic `dedupeKey` and optional canonical `eventId`.

### Services diagram

```mermaid
graph TD
  subgraph Application
    EventService
    Pipeline
    BitcoinService
    CurrencyService
    HealthCheckService
    WorkersService
  end

  subgraph Infrastructure
    BitcoinRpcClient
    CoinMarketCapClient
    Logger
    Storage[FileStorageService]
    Sinks[StdoutSink, FileSink, WebhookSink, KafkaSink, NatsSink]
    RawParser[Raw Parser: ByteReader, Script, TxParser, BlockParser]
  end

  Config[Config/env] --> EventService
  Config --> BitcoinService
  Config --> CurrencyService

  EventService <--> Pipeline
  Pipeline --> BitcoinService
  BitcoinService --> BitcoinRpcClient
  BitcoinService --> RawParser
  Pipeline --> CurrencyService
  CurrencyService --> CoinMarketCapClient
  Pipeline --> Logger
  Pipeline --> Sinks
  Pipeline --> WorkersService

  BitcoinRpcClient -. JSON-RPC .-> QuickNode[(QuickNode / Bitcoin RPC)]
  CoinMarketCapClient -. HTTPS .-> CMC[(CoinMarketCap API)]
```

### Event flow summary

- BlockDetected → BlockParsed → AddressActivityFound → NotificationEmitted
- BlockReorg is emitted on chain rollbacks (height, old/new hashes) for compensating actions downstream.

### Operational considerations

- Horizontal scaling via `WorkersService` partitions watchlists by Rendezvous hashing.
- Sinks are pluggable; default is stdout. File/webhook/Kafka/NATS can be enabled via config.
- Feature flags: `parseRawBlocks`, `resolveInputAddresses` are centralized and hot-reloadable.


