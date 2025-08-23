import { logger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { BitcoinService, CurrencyService } from "@/application/services";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";

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
    defaultBase: "BTC",
    defaultQuote: "USD",
  });

  // Health checks during startup
  await btc.connect();
  const btcHealth = await btc.ping();
  if (!btcHealth.ok) {
    throw new Error(`Bitcoin RPC health check failed: ${btcHealth.details?.error || "unknown error"}`);
  }
  logger.info({ type: "health", provider: btcHealth.provider, status: btcHealth.status, latencyMs: btcHealth.latencyMs });

  const curHealth = await currency.ping();
  if (!curHealth.ok) {
    throw new Error(`Currency provider health check failed: ${curHealth.details?.error || "unknown error"}`);
  }
  logger.info({ type: "health", provider: curHealth.provider, status: curHealth.status, latencyMs: curHealth.latencyMs });

  let lastHeight: number | undefined = undefined;
  for (;;) {
    const block = await btc.awaitNewBlock(lastHeight);
    lastHeight = block.height;

    // Fetch rate once per block for consistency and to reduce API calls
    let rate = 0;
    try {
      const pair = await currency.getPair("BTC", "USD");
      rate = pair.rate;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ type: "currency.error", msg: message });
    }

    const activities = btc.checkTransactions(block, cfg.watch).map((a) => ({
      ...a,
      valueUsd: rate > 0 ? Number((a.valueBtc * rate).toFixed(2)) : undefined,
    }));

    // Emit a block summary
    logger.info({
      type: "block.activities",
      blockHeight: block.height,
      blockHash: block.hash,
      txCount: block.transactions.length,
      activityCount: activities.length,
    });

    // Emit per-activity notifications
    for (const act of activities) {
      logger.info({
        type: "transaction.activity",
        blockHeight: block.height,
        blockHash: block.hash,
        txid: act.txid,
        address: act.address,
        label: act.label,
        direction: act.direction,
        valueBtc: act.valueBtc,
        valueUsd: act.valueUsd,
      });
    }

    // Emit OP_RETURN data when present in any tx outputs
    for (const tx of block.transactions) {
      for (const out of tx.outputs) {
        if (out.scriptType === "nulldata" && (out.opReturnDataHex || out.opReturnUtf8)) {
          logger.info({
            type: "transaction.op_return",
            blockHeight: block.height,
            blockHash: block.hash,
            txid: tx.txid,
            opReturnHex: out.opReturnDataHex,
            opReturnUtf8: out.opReturnUtf8,
          });
        }
      }
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, msg: `Startup failed: ${message}` });
  process.exit(1);
});

