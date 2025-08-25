import { normalizeWatchedAddresses } from "@/app/helpers/bitcoin";
import { closeAllHttpPools, configureHttpKeepAlive } from "@/app/helpers/http";
import {
  BitcoinService,
  CurrencyService,
  EventService,
  FeatureFlagsService,
  HealthCheckService,
  WorkersService
} from "@/app/services";
import { registerEventPipeline } from "@/app/services/Pipeline";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { logger } from "@/infrastructure/logger";
import { getFileStorage } from "@/infrastructure/storage/FileStorageService";
import { BTC, USD } from "@/shared/constants";

async function main() {
  const cfg = loadConfig();
  const rpc = new BitcoinRpcClient( { url: cfg.bitcoinRpcUrl } );
  const flags = new FeatureFlagsService(
    {
      parseRawBlocks: cfg.parseRawBlocks,
      resolveInputAddresses: cfg.resolveInputAddresses,
    },
    {
      filePath: process.env.FEATURE_FLAGS_FILE,
      reloadIntervalMs: process.env.FEATURE_FLAGS_RELOAD_MS
        ? Number( process.env.FEATURE_FLAGS_RELOAD_MS )
        : undefined,
    }
  );
  const btc = new BitcoinService( rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
    parseRawBlocks: cfg.parseRawBlocks,
    network: cfg.network as any,
    flagsService: flags,
  } );
  const events = new EventService( { maxQueueSize: cfg.maxEventQueueSize } );
  const cmcClient = new CoinMarketCapClient( {
    apiKey: cfg.coinMarketCapApiKey,
  } );
  const currency = new CurrencyService( cmcClient, {
    defaultBase: BTC,
    defaultQuote: USD,
  } );

  // Configure HTTP keep-alive pools for known hosts
  try {
    const rpcHost = new URL( cfg.bitcoinRpcUrl ).hostname;
    const perHostConnections: Record<string, number> = {};
    perHostConnections[rpcHost] = 8;
    perHostConnections["pro-api.coinmarketcap.com"] = 4;
    configureHttpKeepAlive( {
      defaultConnections: 6,
      perHostConnections,
      keepAliveTimeoutMs: 30000,
      keepAliveMaxTimeoutMs: 60000,
      pipelining: 1,
    } );
  } catch {
    // ignore URL parsing errors; use defaults
  }

  // Health checks during startup
  const health = new HealthCheckService();
  await health.runStartupChecks( btc, currency );

  // Register event pipeline (subscriptions & handlers)
  const liveWatchRef = registerEventPipeline( events, { btc, currency }, cfg );

  // Hot-reload watch list with debounce and atomic in-memory swap
  // Works when a watch file path is provided and exists
  if ( cfg.watchAddressesFile ) {
    const storage = getFileStorage();
    const path = cfg.watchAddressesFile;
    const debounceMs = 500;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let lastMtimeMs: number | undefined = undefined;
    const workers = new WorkersService( cfg.worker.id, cfg.worker.members );

    const reload = () => {
      try {
        // Double-read pattern to avoid partial writes: read into temp, then parse
        const raw = storage.readFile( path, "utf-8" );
        const json = JSON.parse( raw );
        if ( !Array.isArray( json ) ) return;
        const net: any = cfg.network as any;
        const items = json
          .filter( (x: any) => typeof x?.address === "string" )
          .map( (x: any) => ({ address: x.address, label: x.label }) );
        const normalized = normalizeWatchedAddresses( items, net );
        const filtered = workers.filterWatched( normalized );
        // Atomic in-place swap: mutate the existing array reference
        liveWatchRef.splice( 0, liveWatchRef.length, ...filtered );
        // Rebuild precomputed indices in service
        (btc as any).setWatchedAddresses?.( liveWatchRef );
        logger.info( { type: "watch.reload", count: liveWatchRef.length, path } );
      } catch ( err ) {
        const message = err instanceof Error ? err.message : String( err );
        logger.warn( { type: "watch.reload_failed", path, err: message } );
      }
    };

    const schedule = () => {
      if ( timer ) clearTimeout( timer );
      timer = setTimeout( reload, debounceMs );
    };

    try {
      const fs = await import("fs");
      if ( storage.fileExists( path ) ) {
        try {
          const stat = fs.statSync( path );
          lastMtimeMs = stat.mtimeMs;
        } catch {
        }
        fs.watch( path, { persistent: false }, () => {
          try {
            const stat = fs.statSync( path );
            if ( lastMtimeMs && stat.mtimeMs === lastMtimeMs ) return;
            lastMtimeMs = stat.mtimeMs;
          } catch {
            // file may be temporarily unavailable; still schedule reload
          }
          schedule();
        } );
        logger.info( { type: "watch.init", path } );
      }
    } catch {
      logger.warn( { type: "watch.init_failed", path } );
    }
  }

  let lastHeight: number | undefined = undefined;
  let lastHash: string | undefined = undefined;

  // Backpressure-aware producer: waits when event backlog is high
  async function produceBlocks(): Promise<void> {
    // If the queue is congested, allow consumers to catch up before awaiting the next block
    // We check "BlockDetected" backlog since that's the head of the pipeline
    await events.waitForCapacity( "BlockDetected" );
    const block = await btc.awaitNewBlock( lastHeight );
    // Detect reorg: if the prev block hash doesn't match our lastHash while height advanced by 1
    if (
      typeof lastHeight === "number"
      && block.height === lastHeight + 1
      && lastHash && block.prevHash
      && block.prevHash !== lastHash
    ) {
      const reorgEv = {
        type: "BlockReorg" as const,
        timestamp: new Date().toISOString(),
        height: block.height - 1,
        oldHash: lastHash,
        newHash: block.prevHash,
        eventId: `BlockReorg:${ block.height - 1 }:${ lastHash }->${ block.prevHash }`,
        dedupeKey: `BlockReorg:${ block.height - 1 }:${ lastHash }:${ block.prevHash }`,
      };
      await events.publish( reorgEv as any );
    }
    lastHeight = block.height;
    lastHash = block.hash;
    await events.publish( {
      type: "BlockDetected",
      timestamp: new Date().toISOString(),
      height: block.height,
      hash: block.hash,
      dedupeKey: `BlockDetected:${ block.height }:${ block.hash }`,
      eventId: `BlockDetected:${ block.height }:${ block.hash }`,
    } );
    // Tail recurse to keep producing
    return produceBlocks();
  }

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if ( shuttingDown ) return;
    shuttingDown = true;
    try {
      logger.info( { type: "shutdown.start", signal } );
      // Stop producing new events by preventing further publishing and waiting for a drain
      await events.waitUntilIdle( 5 );
      await closeAllHttpPools();
      logger.info( { type: "shutdown.complete" } );
    } catch ( err ) {
      const message = err instanceof Error ? err.message : String( err );
      logger.error( { type: "shutdown.error", message } );
    } finally {
      process.exit( 0 );
    }
  };
  process.once( "SIGINT", () => void shutdown( "SIGINT" ) );
  process.once( "SIGTERM", () => void shutdown( "SIGTERM" ) );

  await produceBlocks();
}

main().catch( (err) => {
  const message = err instanceof Error ? err.message : String( err );
  logger.error( { err, msg: `Startup failed: ${ message }` } );
  process.exit( 1 );
} );

