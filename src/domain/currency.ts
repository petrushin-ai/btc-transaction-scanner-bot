export type FiatCurrencyCode =
  | "USD";

export type CryptoCurrencyCode = "BTC" | "USDT";

export type CurrencyCode = FiatCurrencyCode | CryptoCurrencyCode;

export type ExchangeRate = {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
  time: string; // ISO timestamp
  source: string; // e.g., coinapi
};

export interface CurrencyRateProvider {
  getRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate>;
}


