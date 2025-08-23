import { CoinMarketCapClient } from "@/infrastructure";
import { CurrencyService } from "@/application/services";
import { logger as getLogger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";

// Use logger that writes NDJSON lines to logs/currency_rates.ndjson
const logger = getLogger({ fileName: "currency_rates" });

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
  logger.info({
    type: "currency.rates",
    curr_req_time: new Date().toISOString(),
    rates: [btcUsdt, usdtUsd],
  });
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`currencyRates failed: ${message}`);
    process.exit(1);
  });
}


