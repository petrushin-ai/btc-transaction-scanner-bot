import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { BitcoinService } from "@/application/services/BitcoinService";
import { loadConfig } from "@/config";
import { getLogger } from "@/infrastructure/logger";

async function main() {
  const logger = getLogger();
  const cfg = loadConfig();
  const rpc = new BitcoinRpcClient({
    url: cfg.bitcoinRpcUrl,
    username: cfg.bitcoinRpcUser,
    password: cfg.bitcoinRpcPassword,
  });
  const svc = new BitcoinService(rpc, {
    pollIntervalMs: cfg.pollIntervalMs,
    resolveInputAddresses: cfg.resolveInputAddresses,
  });

  await svc.connect();
  const latestBlock = await svc.awaitNewBlock();
  const activities = svc.checkTransactions(latestBlock, cfg.watch);
  logger.info({
    type: "block.activities",
    blockHeight: latestBlock.height,
    blockHash: latestBlock.hash,
    activities,
  });
}

// Do not auto-run in production; this is a one-off example
if (import.meta.main) {
  main().catch((err) => {
    const logger = getLogger();
    logger.error({ err }, "runOnce failed");
    process.exit(1);
  });
}

