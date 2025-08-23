import { BTC, USD } from "@/application/constants";
import { logActivities, logBlockSummary, logOpReturnData } from "@/application/helpers/bitcoin";
import { getUsdRate, mapActivitiesWithUsd } from "@/application/helpers/currency";
import { BitcoinService, CurrencyService, HealthCheckService } from "@/application/services";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { logger } from "@/infrastructure/logger";

async function main() {
  const cfg = loadConfig();
  const env = (process.env.APP_ENV || process.env.NODE_ENV || "development").toString().trim();
  if (env === "production") {
    logger.info({ type: "init", mode: "production", msg: "Starting in production mode" });
  }
  const rpc = new BitcoinRpcClient({ url: cfg.bitcoinRpcUrl });
  const btc = new BitcoinService(rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
    parseRawBlocks: cfg.parseRawBlocks,
  });
  const cmcClient = new CoinMarketCapClient({
    apiKey: cfg.coinMarketCapApiKey,
    baseUrl: cfg.coinMarketCapBaseUrl,
  });
  const currency = new CurrencyService(cmcClient, {
    defaultBase: BTC,
    defaultQuote: USD,
  });

  // Health checks during startup
  const health = new HealthCheckService();
  await health.runStartupChecks(btc, currency);

  let lastHeight: number | undefined = undefined;
  for (;;) {
    const block = await btc.awaitNewBlock(lastHeight);
    lastHeight = block.height;

    // Fetch rate once per block for consistency and to reduce API calls
    const rate = await getUsdRate(currency);

    const activities = mapActivitiesWithUsd(
      btc.checkTransactions(block, cfg.watch),
      rate,
    );

    // Emit a block summary only if verbose
    // Summary logs will be emitted at debug level and gated by logger config
    logBlockSummary(block, activities.length);

    // Emit per-activity notifications (always)
    logActivities(block, activities);

    // Emit OP_RETURN data only if verbose
    // OP_RETURN logs at debug level; logger config controls visibility
    logOpReturnData(block);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, msg: `Startup failed: ${message}` });
  process.exit(1);
});

