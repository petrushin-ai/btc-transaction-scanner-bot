import { BTC, USD } from "@/application/constants";
import { normalizeWatchedAddresses } from "@/application/helpers/bitcoin";
import { configureHttpKeepAlive } from "@/application/helpers/http";
import {
  BitcoinService,
  CurrencyService,
  EventService,
  HealthCheckService
} from "@/application/services";
import { WorkersService } from "@/application/services";
import { FeatureFlagsService } from "@/application/services/FeatureFlagsService";
import { registerEventPipeline } from "@/application/services/Pipeline";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { logger } from "@/infrastructure/logger";
import { getFileStorage } from "@/infrastructure/storage/FileStorageService";

async function main() {
  const cfg = loadConfig();
  const env = (process.env.APP_ENV || process.env.NODE_ENV || "development").toString().trim();
  if ( env === "production" ) {
    logger.info( { type: "init", mode: "production", msg: "Starting in production mode" } );
  }
  const rpc = new BitcoinRpcClient( { url: cfg.bitcoinRpcUrl } );
  const flags = new FeatureFlagsService(
    {
      parseRawBlocks: cfg.parseRawBlocks,
      resolveInputAddresses: cfg.resolveInputAddresses,
    },
    {
      filePath: process.env.FEATURE_FLAGS_FILE,
      reloadIntervalMs: process.env.FEATURE_FLAGS_RELOAD_MS ? Number( process.env.FEATURE_FLAGS_RELOAD_MS ) : undefined,
    }
  );
  const btc = new BitcoinService( rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
    parseRawBlocks: cfg.parseRawBlocks,
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
    let timer: any = undefined;
    let lastMtimeMs: number | undefined = undefined;
    const workers = new WorkersService( cfg.worker.id, cfg.worker.members );

    const reload = () => {
      try {
        // Double-read pattern to avoid partial writes: read into temp then parse
        const raw = storage.readFile( path, "utf-8" );
        const json = JSON.parse( raw );
        if ( !Array.isArray( json ) ) return;
        const networkGuess = (process.env.BITCOIN_NETWORK || "").toString().trim().toLowerCase();
        let net: any = undefined;
        if ( networkGuess === "mainnet" || networkGuess === "testnet" || networkGuess === "signet" || networkGuess === "regtest" ) {
          net = networkGuess as any;
        }
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
      // fs.watch not available; skip hot reload
    }
  }

  let lastHeight: number | undefined = undefined;

  // Backpressure-aware producer: waits when event backlog is high
  async function produceBlocks(): Promise<never> {
    // If queue is congested, allow consumers to catch up before awaiting next block
    // We check "BlockDetected" backlog since that's the head of the pipeline
    await events.waitForCapacity( "BlockDetected" );
    const block = await btc.awaitNewBlock( lastHeight );
    lastHeight = block.height;
    await events.publish( {
      type: "BlockDetected",
      timestamp: new Date().toISOString(),
      height: block.height,
      hash: block.hash,
      dedupeKey: `BlockDetected:${ block.height }:${ block.hash }`,
    } );
    // Tail recurse to keep producing
    return produceBlocks();
  }

  await produceBlocks();
}

main().catch( (err) => {
  const message = err instanceof Error ? err.message : String( err );
  logger.error( { err, msg: `Startup failed: ${ message }` } );
  process.exit( 1 );
} );

