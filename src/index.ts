import { BTC, USD } from "@/application/constants";
import { BitcoinService, CurrencyService, EventService, HealthCheckService } from "@/application/services";
import { registerEventPipeline } from "@/application/services/Pipeline";
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
  const events = new EventService({ maxQueueSize: cfg.maxEventQueueSize });
  const cmcClient = new CoinMarketCapClient({
    apiKey: cfg.coinMarketCapApiKey,
  });
  const currency = new CurrencyService(cmcClient, {
    defaultBase: BTC,
    defaultQuote: USD,
  });

  // Health checks during startup
  const health = new HealthCheckService();
  await health.runStartupChecks(btc, currency);

  // Register event pipeline (subscriptions & handlers)
  registerEventPipeline(events, { btc, currency }, cfg);

  let lastHeight: number | undefined = undefined;
  for (;;) {
    const block = await btc.awaitNewBlock(lastHeight);
    lastHeight = block.height;
    await events.publish({
      type: "BlockDetected",
      timestamp: new Date().toISOString(),
      height: block.height,
      hash: block.hash,
    });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, msg: `Startup failed: ${message}` });
  process.exit(1);
});

