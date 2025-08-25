export const BTC = "BTC" as const;
export const USDT = "USDT" as const;
export const USD = "USD" as const;

export const FIAT_CURRENCY_CODES = [ USD ] as const;
export type FiatCurrencyCode = typeof FIAT_CURRENCY_CODES[number];

export const CRYPTO_CURRENCY_CODES = [ BTC, USDT ] as const;
export type CryptoCurrencyCode = typeof CRYPTO_CURRENCY_CODES[number];

export type CurrencyCode = FiatCurrencyCode | CryptoCurrencyCode;

export function isFiatCurrencyCode(code: string | CurrencyCode): code is FiatCurrencyCode {
  return (FIAT_CURRENCY_CODES as readonly string[]).includes( code as string );
}

export function isCryptoCurrencyCode(code: string | CurrencyCode): code is CryptoCurrencyCode {
  return (CRYPTO_CURRENCY_CODES as readonly string[]).includes( code as string );
}

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


