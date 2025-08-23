import type { CurrencyCode, ExchangeRate } from "@/domain/currency";

export type CoinMarketCapClientOptions = {
  apiKey: string;
  baseUrl?: string; // default: https://pro-api.coinmarketcap.com
  timeoutMs?: number; // default: 5000
};

function isCrypto(code: string): boolean {
  // Runtime guard for our current domain set
  return code === "BTC" || code === "USDT";
}

function isFiat(code: string): boolean {
  return code === "USD";
}

export class CoinMarketCapClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: CoinMarketCapClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || "https://pro-api.coinmarketcap.com").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async getExchangeRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate> {
    // Supports crypto->crypto and crypto<->fiat pairs via /v2/tools/price-conversion
    // If base is crypto: symbol=base, convert=quote
    // If base is fiat and quote is crypto: symbol=quote, convert=base, then invert
    if (isCrypto(base)) {
      const { price, time } = await this.convertOne(base, quote);
      return {
        base,
        quote,
        rate: price,
        time,
        source: "coinmarketcap",
      };
    }
    if (isFiat(base) && isCrypto(quote)) {
      const { price, time } = await this.convertOne(quote, base);
      const rate = price === 0 ? 0 : 1 / price;
      return {
        base,
        quote,
        rate,
        time,
        source: "coinmarketcap",
      };
    }
    if (isFiat(base) && isFiat(quote)) {
      // Only USD supported in domain; trivial case
      if (base === quote) {
        return {
          base,
          quote,
          rate: 1,
          time: new Date().toISOString(),
          source: "coinmarketcap",
        };
      }
    }
    throw new Error(`Unsupported currency pair: ${base}/${quote}`);
  }

  private async convertOne(symbol: string, convert: string): Promise<{ price: number; time: string }> {
    const url = `${this.baseUrl}/v2/tools/price-conversion?amount=1&symbol=${encodeURIComponent(symbol)}&convert=${encodeURIComponent(convert)}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-CMC_PRO_API_KEY": this.apiKey,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`CoinMarketCap request failed: ${res.status} ${res.statusText} ${text}`.trim());
      }
      const json = (await res.json()) as any;
      const data = Array.isArray(json?.data) ? json.data[0] : json?.data;
      const q = data?.quote?.[convert];
      if (q && typeof q.price === "number") {
        const time = q.last_updated || data?.last_updated || json?.status?.timestamp || new Date().toISOString();
        return { price: q.price, time };
      }
      // Fallback to quotes/latest
      return await this.fetchQuoteLatest(symbol, convert);
    } finally {
      clearTimeout(id);
    }
  }

  private async fetchQuoteLatest(symbol: string, convert: string): Promise<{ price: number; time: string }> {
    const url = `${this.baseUrl}/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}&convert=${encodeURIComponent(convert)}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-CMC_PRO_API_KEY": this.apiKey,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`CoinMarketCap request failed: ${res.status} ${res.statusText} ${text}`.trim());
      }
      const json = (await res.json()) as any;
      const item = json?.data?.[symbol] || (Array.isArray(json?.data) ? json.data[0] : undefined);
      const q = item?.quote?.[convert];
      if (!q || typeof q.price !== "number") {
        throw new Error(`CoinMarketCap malformed response for ${symbol}->${convert}`);
      }
      const time = q.last_updated || json?.status?.timestamp || new Date().toISOString();
      return { price: q.price, time };
    } finally {
      clearTimeout(id);
    }
  }
}


