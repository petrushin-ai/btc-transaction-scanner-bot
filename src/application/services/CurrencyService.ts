import type { CurrencyRateProvider } from "@/domain/currency";
import type { CurrencyCode, ExchangeRate } from "@/domain/currency";
import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";

export type CurrencyServiceOptions = {
  defaultBase?: CurrencyCode; // e.g. BTC
  defaultQuote?: CurrencyCode; // e.g. USD
};

export class CurrencyService implements CurrencyRateProvider {
  private client: CoinMarketCapClient;
  private defaultBase?: CurrencyCode;
  private defaultQuote?: CurrencyCode;

  constructor(client: CoinMarketCapClient, opts?: CurrencyServiceOptions) {
    this.client = client;
    this.defaultBase = opts?.defaultBase;
    this.defaultQuote = opts?.defaultQuote;
  }

  async getRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate> {
    return this.client.getExchangeRate(base, quote);
  }

  async getPair(base?: CurrencyCode, quote?: CurrencyCode): Promise<ExchangeRate> {
    const b = base ?? this.defaultBase;
    const q = quote ?? this.defaultQuote;
    if (!b || !q) throw new Error("Currency pair is not specified");
    return this.client.getExchangeRate(b, q);
  }
}


