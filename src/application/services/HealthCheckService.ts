import type { HealthResult } from "@/types/healthcheck";
import { logHealthResult } from "@/application/helpers/healthcheck";
import { BitcoinService } from "./BitcoinService";
import { CurrencyService } from "./CurrencyService";

export class HealthCheckService {
  async runStartupChecks(bitcoin: BitcoinService, currency: CurrencyService): Promise<HealthResult[]> {
    await bitcoin.connect();

    const [btcHealth, curHealth] = await Promise.all([
      (async () => {
        try {
          return await bitcoin.ping();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { provider: "bitcoin-rpc", ok: false, status: "error", latencyMs: 0, checkedAt: new Date().toISOString(), details: { error: message } } as HealthResult;
        }
      })(),
      (async () => {
        try {
          return await currency.ping();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { provider: "coinmarketcap", ok: false, status: "error", latencyMs: 0, checkedAt: new Date().toISOString(), details: { error: message } } as HealthResult;
        }
      })(),
    ]);

    logHealthResult(btcHealth);
    logHealthResult(curHealth);

    if (!btcHealth.ok) {
      throw new Error(`Bitcoin RPC health check failed: ${btcHealth.details && (btcHealth.details as any).error || "unknown error"}`);
    }
    if (!curHealth.ok) {
      throw new Error(`Currency provider health check failed: ${curHealth.details && (curHealth.details as any).error || "unknown error"}`);
    }

    return [btcHealth, curHealth];
  }
}


