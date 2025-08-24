import { BitcoinService } from "src/application/services/BitcoinService";
import { loadConfig } from "src/config";
import { BitcoinRpcClient } from "src/infrastructure/bitcoin";
import { logger } from "src/infrastructure/logger";

async function main() {
  const cfg = loadConfig();
  const rpc = new BitcoinRpcClient( {
    url: cfg.bitcoinRpcUrl,
  } );
  const svc = new BitcoinService( rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
  } );

  await svc.connect();
  const latestBlock = await svc.awaitNewBlock();
  const activities = svc.checkTransactions( latestBlock, cfg.watch );
  logger.info( {
    type: "block.activities",
    blockHeight: latestBlock.height,
    blockHash: latestBlock.hash,
    activities,
  } );
}

// Do not auto-run in production; this is a one-off scripts
if ( import.meta.main ) {
  main().catch( (err) => {
    const message = err instanceof Error ? err.message : String( err );
    logger.error( `runOnce failed: ${ message }` );
    process.exit( 1 );
  } );
}

