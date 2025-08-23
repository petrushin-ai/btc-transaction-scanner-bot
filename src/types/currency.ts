import { BTC, USD, USDT } from "@/application/constants";

export type FiatCurrencyCode = typeof USD;

export type CryptoCurrencyCode = typeof BTC | typeof USDT;

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


