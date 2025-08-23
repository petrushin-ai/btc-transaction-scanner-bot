import { logger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { BitcoinService, CurrencyService, HealthCheckService } from "@/application/services";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { getUsdRate, mapActivitiesWithUsd } from "@/application/helpers/currency";
import { logBlockSummary, logActivities, logOpReturnData } from "@/application/helpers/bitcoin";
import { BTC, USD } from "@/application/constants";

async function main() {
  const cfg = loadConfig();
  const rpc = new BitcoinRpcClient({ url: cfg.bitcoinRpcUrl });
  const btc = new BitcoinService(rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
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

    // Emit a block summary
    logBlockSummary(block, activities.length);

    // Emit per-activity notifications
    logActivities(block, activities);

    // Emit OP_RETURN data when present in any tx outputs
    logOpReturnData(block);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, msg: `Startup failed: ${message}` });
  process.exit(1);
});

