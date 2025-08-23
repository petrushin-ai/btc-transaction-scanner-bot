import { logger } from "@/infrastructure/logger";
import type { HealthResult } from "@/types/health";

export function logHealthResult(health: HealthResult): void {
  logger.info({ type: "health", provider: health.provider, status: health.status, latencyMs: health.latencyMs });
}


