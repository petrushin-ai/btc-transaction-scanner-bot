import { BitcoinService, CurrencyService } from "src/application/services";
import { loadConfig } from "src/config";
import { BitcoinRpcClient } from "src/infrastructure/bitcoin";
import { CoinMarketCapClient } from "src/infrastructure/currency/CoinMarketCapClient";
import { logger as getLogger } from "src/infrastructure/logger";

const logger = getLogger( { fileName: "healthcheck" } );

async function main() {
  const cfg = loadConfig();

  const rpc = new BitcoinRpcClient( { url: cfg.bitcoinRpcUrl } );
  const btc = new BitcoinService( rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
  } );

  const cmc = new CoinMarketCapClient( {
    apiKey: cfg.coinMarketCapApiKey,
  } );
  const currency = new CurrencyService( cmc );

  const [ btcHealth, curHealth ] = await Promise.all( [
    (async () => {
      try {
        await btc.connect();
        return await btc.ping();
      } catch ( err ) {
        const message = err instanceof Error ? err.message : String( err );
        return {
          provider: "bitcoin-rpc",
          ok: false,
          status: "error",
          latencyMs: 0,
          checkedAt: new Date().toISOString(),
          details: { error: message }
        } as const;
      }
    })(),
    (async () => {
      try {
        return await currency.ping();
      } catch ( err ) {
        const message = err instanceof Error ? err.message : String( err );
        return {
          provider: "coinmarketcap",
          ok: false,
          status: "error",
          latencyMs: 0,
          checkedAt: new Date().toISOString(),
          details: { error: message }
        } as const;
      }
    })(),
  ] );

  logger.info( {
    type: "health",
    provider: btcHealth.provider,
    status: btcHealth.status,
    ok: btcHealth.ok,
    latencyMs: btcHealth.latencyMs,
    details: btcHealth.details
  } );
  logger.info( {
    type: "health",
    provider: curHealth.provider,
    status: curHealth.status,
    ok: curHealth.ok,
    latencyMs: curHealth.latencyMs,
    details: curHealth.details
  } );

  if ( !btcHealth.ok || !curHealth.ok ) {
    process.exitCode = 2;
  }
}

if ( import.meta.main ) {
  main().catch( (err) => {
    const message = err instanceof Error ? err.message : String( err );
    console.error( JSON.stringify( { type: "health", msg: `Healthcheck failed: ${ message }` } ) );
    process.exit( 2 );
  } );
}


