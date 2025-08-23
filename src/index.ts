import { logger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { BitcoinService, CurrencyService } from "@/application/services";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { logHealthResult } from "@/application/helpers/health";
import { getUsdRateSafely, mapActivitiesWithUsd } from "@/application/helpers/currency";
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
  await btc.connect();
  const btcHealth = await btc.ping();
  if (!btcHealth.ok) throw new Error(`Bitcoin RPC health check failed: ${btcHealth.details?.error || "unknown error"}`);
  logHealthResult(btcHealth);

  const curHealth = await currency.ping();
  if (!curHealth.ok) throw new Error(`Currency provider health check failed: ${curHealth.details?.error || "unknown error"}`);
  logHealthResult(curHealth);

  let lastHeight: number | undefined = undefined;
  for (;;) {
    const block = await btc.awaitNewBlock(lastHeight);
    lastHeight = block.height;

    // Fetch rate once per block for consistency and to reduce API calls
    const rate = await getUsdRateSafely(currency);

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

