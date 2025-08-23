import type { CurrencyCode, ExchangeRate } from "@/domain/currency";

export type CoinApiClientOptions = {
  apiKey: string;
  baseUrl?: string; // default: https://rest.coinapi.io
  timeoutMs?: number; // default: 5000
};

export class CoinApiClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: CoinApiClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || "https://rest.coinapi.io").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async getExchangeRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate> {
    const url = `${this.baseUrl}/v1/exchangerate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-CoinAPI-Key": this.apiKey,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`CoinAPI request failed: ${res.status} ${res.statusText} ${text}`.trim());
      }
      const data = (await res.json()) as {
        time: string;
        asset_id_base: string;
        asset_id_quote: string;
        rate: number;
      };
      return {
        base: data.asset_id_base as CurrencyCode,
        quote: data.asset_id_quote as CurrencyCode,
        rate: data.rate,
        time: data.time,
        source: "coinapi",
      };
    } finally {
      clearTimeout(id);
    }
  }
}


