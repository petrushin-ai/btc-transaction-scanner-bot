import { logger } from "@/infrastructure/logger";
import { loadConfig } from "@/config";

// Using named singleton logger

try {
  loadConfig();
  logger.info({ msg: "App started" });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, msg: `Startup failed: ${message}` });
  process.exit(1);
}

