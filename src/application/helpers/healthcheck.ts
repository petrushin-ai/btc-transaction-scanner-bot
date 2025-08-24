import { logger } from "@/infrastructure/logger";
import { getLoggingEnv } from "@/infrastructure/logger/helpers";
import type { HealthResult } from "@/types/healthcheck";

export function logHealthResult(health: HealthResult): void {
  const { environment } = getLoggingEnv();
  const payload = {
    type: "health",
    provider: health.provider,
    status: health.status,
    latencyMs: health.latencyMs
  } as const;
  if ( environment === "development" ) {
    logger.info( payload );
  } else {
    logger.debug( payload );
  }
}


