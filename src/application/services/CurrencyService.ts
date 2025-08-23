import path from "path";
import {fileURLToPath} from "url";

import {CoinMarketCapClient} from "@/infrastructure/currency/CoinMarketCapClient";
import {getFileStorage} from "@/infrastructure/storage/FileStorageService";
import type {CurrencyCode, CurrencyRateProvider, ExchangeRate} from "@/types/currency";
import type {HealthResult} from "@/types/healthcheck";

export type CurrencyServiceOptions = {
  defaultBase?: CurrencyCode; // e.g. BTC
  defaultQuote?: CurrencyCode; // e.g. USD
  cacheFilePath?: string; // default: <cwd>/cache/currency_rates.json
  cacheValiditySeconds?: number; // default: env CUR_CACHE_VALIDITY_PERIOD or 3600
  providerName?: string; // default: coinmarketcap
};

export class CurrencyService implements CurrencyRateProvider {
  private client: CoinMarketCapClient;
  private defaultBase?: CurrencyCode;
  private defaultQuote?: CurrencyCode;
  private cacheFilePath: string;
  private cacheValiditySeconds: number;
  private providerName: string;

  constructor(client: CoinMarketCapClient, opts?: CurrencyServiceOptions) {
    this.client = client;
    this.defaultBase = opts?.defaultBase;
    this.defaultQuote = opts?.defaultQuote;
    const projectRoot = this.resolveProjectRoot();
    this.cacheFilePath = opts?.cacheFilePath || path.join(projectRoot, "cache", "currency_rates.json");
    const envValiditySeconds = Number((
      process.env.CUR_CACHE_VALIDITY_PERIOD || "3600"
    ).toString().trim());
    this.cacheValiditySeconds = Number.isFinite(opts?.cacheValiditySeconds || NaN)
      ? (opts!.cacheValiditySeconds as number)
      : (Number.isFinite(envValiditySeconds) && envValiditySeconds > 0 ? envValiditySeconds : 3600);
    this.providerName = (opts?.providerName || "coinmarketcap").toLowerCase();
  }

  async getRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate> {
    const cached = this.getCachedRate(base, quote);
    if (cached) return cached;
    const fresh = await this.client.getExchangeRate(base, quote);
    this.saveRateToCache(fresh);
    return fresh;
  }

  async getPair(base?: CurrencyCode, quote?: CurrencyCode): Promise<ExchangeRate> {
    const b = base ?? this.defaultBase;
    const q = quote ?? this.defaultQuote;
    if (!b || !q) throw new Error("Currency pair is not specified");
    return this.getRate(b, q);
  }

  async ping(): Promise<HealthResult> {
    return this.client.ping();
  }

  private ensureCacheDirectory(): void {
    const storage = getFileStorage();
    storage.ensureDir(path.dirname(this.cacheFilePath));
    storage.ensureFile(this.cacheFilePath, "{}");
  }

  private resolveProjectRoot(): string {
    const storage = getFileStorage();
    const hasPkg = (dir: string) => storage.fileExists(path.join(dir, "package.json"));
    const findBaseDir = (startDir: string): string => {
      let current = startDir;
      while (true) {
        if (hasPkg(current)) return current;
        const parent = path.dirname(current);
        if (parent === current) return startDir;
        current = parent;
      }
    };
    // Try from process cwd first, then from this module's directory
    const fromCwd = findBaseDir(process.cwd());
    if (hasPkg(fromCwd)) return fromCwd;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const fromModule = findBaseDir(moduleDir);
    return hasPkg(fromModule) ? fromModule : process.cwd();
  }

  private readCache(): any {
    this.ensureCacheDirectory();
    try {
      const storage = getFileStorage();
      if (!storage.fileExists(this.cacheFilePath)) return {};
      const content = storage.readFile(this.cacheFilePath, "utf-8");
      if (!content.trim()) return {};
      const json = JSON.parse(content);
      return (json && typeof json === "object") ? json : {};
    } catch {
      return {};
    }
  }

  private writeCache(cache: any): void {
    this.ensureCacheDirectory();
    try {
      const serialized = JSON.stringify(cache, null, 2);
      const storage = getFileStorage();
      storage.writeFile(this.cacheFilePath, serialized, "utf-8");
    } catch {
      // best-effort cache; ignore write errors
    }
  }

  private getPairKey(base: CurrencyCode, quote: CurrencyCode): string {
    return `${base}_${quote}`.toUpperCase();
  }

  private getCachedRate(base: CurrencyCode, quote: CurrencyCode): ExchangeRate | null {
    const cache = this.readCache();
    const providerSection = cache?.[this.providerName];
    if (!providerSection || typeof providerSection !== "object") return null;
    const key = this.getPairKey(base, quote);
    const entry = providerSection[key];
    if (!entry || typeof entry !== "object") return null;
    const cachedAtStr: string | undefined = entry.cachedAt || entry.time;
    if (!cachedAtStr) return null;
    const cachedAtMs = Date.parse(cachedAtStr);
    if (!Number.isFinite(cachedAtMs)) return null;
    const ageSeconds = Math.max(0, Math.floor((Date.now() - cachedAtMs) / 1000));
    if (ageSeconds > this.cacheValiditySeconds) return null;
    // Return as ExchangeRate (ignore cachedAt)
    return {
      base: entry.base,
      quote: entry.quote,
      rate: entry.rate,
      time: entry.time,
      source: entry.source || this.providerName,
    } as ExchangeRate;
  }

  private saveRateToCache(rate: ExchangeRate): void {
    const cache = this.readCache();
    const providerKey = (rate.source || this.providerName).toLowerCase();
    const key = this.getPairKey(rate.base, rate.quote);
    if (!cache[providerKey] || typeof cache[providerKey] !== "object") {
      cache[providerKey] = {};
    }
    cache[providerKey][key] = {...rate, cachedAt: new Date().toISOString()};
    this.writeCache(cache);
  }
}


