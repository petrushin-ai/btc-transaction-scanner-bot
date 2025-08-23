import { CoinMarketCapClient } from "@/infrastructure";
import { CurrencyService } from "@/application/services";
import { logger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";

async function main() {
  const config = loadConfig();
  const client = new CoinMarketCapClient({
    apiKey: config.coinMarketCapApiKey,
    baseUrl: config.coinMarketCapBaseUrl,
  });
  const currency = new CurrencyService(client);

  const [btcUsdt, usdtUsd] = await Promise.all([
    currency.getRate("BTC", "USDT"),
    currency.getRate("USDT", "USD"),
  ]);

  // Output as JSON suitable for stdout processing
  const out = {
    type: "currency.rates",
    time: new Date().toISOString(),
    rates: [btcUsdt, usdtUsd],
  } as const;
  logger.info(out);
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`currencyRates failed: ${message}`);
    process.exit(1);
  });
}


