export type HealthState = "ok" | "degraded" | "error";

export type HealthResult = {
  provider: string;
  ok: boolean;
  status: HealthState;
  latencyMs: number;
  checkedAt: string;
  details?: Record<string, unknown>;
};


