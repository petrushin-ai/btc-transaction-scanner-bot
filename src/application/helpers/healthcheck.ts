import {logger} from "@/infrastructure/logger";
import type {HealthResult} from "@/types/healthcheck";

export function logHealthResult(health: HealthResult): void {
  // Health checks are debug-level; logger gating controls visibility
  logger.debug({
    type: "health",
    provider: health.provider,
    status: health.status,
    latencyMs: health.latencyMs
  });
}


