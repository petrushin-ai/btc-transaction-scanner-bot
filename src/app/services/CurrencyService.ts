import path from "path";
import { fileURLToPath } from "url";

import { CoinMarketCapClient } from "@/infrastructure/currency/CoinMarketCapClient";
import { getFileStorage } from "@/infrastructure/storage/FileStorageService";
import type { CurrencyCode, CurrencyRateProvider, ExchangeRate } from "@/types/currency";
import type { HealthResult } from "@/types/healthcheck";

export type CurrencyServiceOptions = {
  defaultBase?: CurrencyCode; // e.g. BTC
  defaultQuote?: CurrencyCode; // e.g. USD
  cacheFilePath?: string; // default: <cwd>/cache/currency_rates.json
  cacheValiditySeconds?: number; // default: env CUR_CACHE_VALIDITY_PERIOD or 3600
  providerName?: string; // default: coinmarketcap
};

export class CurrencyService implements CurrencyRateProvider {
  private readonly defaultBase?: CurrencyCode;
  private readonly defaultQuote?: CurrencyCode;
  private readonly cacheFilePath: string;
  private readonly cacheValiditySeconds: number;
  private readonly providerName: string;
  private client: CoinMarketCapClient;
  // In-memory hot cache to avoid frequent filesystem reads within a validity window
  private memoryCache: Map<string, { rate: ExchangeRate; cachedAtMs: number }> = new Map();
  // De-duplicate concurrent fetches for the same pair
  private inflight: Map<string, Promise<ExchangeRate>> = new Map();
  // Negative cache (memory) for recent provider failures
  private negativeMemoryCache: Map<string, {
    errorMessage: string;
    statusCode?: number;
    cachedAtMs: number;
    ttlSeconds: number
  }> = new Map();
  // Simple circuit breaker
  private consecutiveFailures: number = 0;
  private circuitOpenUntilMs: number = 0;

  constructor(client: CoinMarketCapClient, opts?: CurrencyServiceOptions) {
    this.client = client;
    this.defaultBase = opts?.defaultBase;
    this.defaultQuote = opts?.defaultQuote;
    const projectRoot = this.resolveProjectRoot();
    this.cacheFilePath = opts?.cacheFilePath || path.join( projectRoot, "cache", "currency_rates.json" );
    const envValiditySeconds = Number( (
      process.env.CUR_CACHE_VALIDITY_PERIOD || "3600"
    ).toString().trim() );
    this.cacheValiditySeconds = Number.isFinite( opts?.cacheValiditySeconds || NaN )
      ? (opts!.cacheValiditySeconds as number)
      : (
        Number.isFinite( envValiditySeconds ) && envValiditySeconds > 0
          ? envValiditySeconds
          : 3600
      );
    this.providerName = (opts?.providerName || "coinmarketcap").toLowerCase();
  }

  async getRate(base: CurrencyCode, quote: CurrencyCode): Promise<ExchangeRate> {
    const key = this.getCacheKey( base, quote );
    const now = Date.now();
    const effectiveTtlSeconds = this.getEffectiveTtlSeconds();
    // 1) In-memory cache first
    const mem = this.memoryCache.get( key );
    if ( mem ) {
      const ageSeconds = Math.max( 0, Math.floor( (now - mem.cachedAtMs) / 1000 ) );
      if ( ageSeconds <= effectiveTtlSeconds ) {
        return mem.rate;
      }
    }

    // 2) File cache next
    const cached = this.getCachedRate( base, quote, effectiveTtlSeconds );
    if ( cached ) {
      this.memoryCache.set( key, { rate: cached, cachedAtMs: Date.now() } );
      return cached;
    }

    // 2.5) Negative cache check
    const neg = this.getNegativeCached( base, quote );
    if ( neg ) {
      const stale = this.getStaleCachedRate( base, quote );
      if ( stale ) {
        this.memoryCache.set( key, { rate: stale, cachedAtMs: Date.now() } );
        return stale;
      }
      throw new Error( neg.errorMessage || "rate temporarily unavailable" );
    }

    // Circuit breaker
    if ( this.isCircuitOpen() ) {
      const stale = this.getStaleCachedRate( base, quote );
      if ( stale ) {
        this.memoryCache.set( key, { rate: stale, cachedAtMs: Date.now() } );
        return stale;
      }
      throw new Error( "currency provider circuit open; no cached rate available" );
    }

    // 3) De-duplicate concurrent fetches
    const existing = this.inflight.get( key );
    if ( existing ) return existing;

    const fetching = (async () => {
      try {
        const fresh = await this.client.getExchangeRate( base, quote );
        this.onSuccess();
        this.saveRateToCache( fresh );
        this.memoryCache.set( key, { rate: fresh, cachedAtMs: Date.now() } );
        return fresh;
      } catch ( err ) {
        const message = err instanceof Error ? err.message : String( err );
        const statusCode = this.parseStatusCodeFromError( err );
        this.onFailure();
        this.saveNegativeToCache( base, quote, message, statusCode );
        const stale = this.getStaleCachedRate( base, quote );
        if ( stale ) {
          this.memoryCache.set( key, { rate: stale, cachedAtMs: Date.now() } );
          return stale;
        }
        throw err;
      }
    })();

    this.inflight.set( key, fetching );
    try {
      return await fetching;
    } finally {
      this.inflight.delete( key );
    }
  }

  async getPair(base?: CurrencyCode, quote?: CurrencyCode): Promise<ExchangeRate> {
    const b = base ?? this.defaultBase;
    const q = quote ?? this.defaultQuote;
    if ( !b || !q ) throw new Error( "Currency pair is not specified" );
    return this.getRate( b, q );
  }

  async ping(): Promise<HealthResult> {
    return this.client.ping();
  }

  private ensureCacheDirectory(): void {
    const storage = getFileStorage();
    storage.ensureDir( path.dirname( this.cacheFilePath ) );
    storage.ensureFile( this.cacheFilePath, "{}" );
  }

  private resolveProjectRoot(): string {
    const storage = getFileStorage();
    const hasPkg = (dir: string) => storage.fileExists( path.join( dir, "package.json" ) );
    const findBaseDir = (startDir: string): string => {
      let current = startDir;
      while ( true ) {
        if ( hasPkg( current ) ) return current;
        const parent = path.dirname( current );
        if ( parent === current ) return startDir;
        current = parent;
      }
    };
    // Try from process cwd first, then from this module's directory
    const fromCwd = findBaseDir( process.cwd() );
    if ( hasPkg( fromCwd ) ) return fromCwd;
    const moduleDir = path.dirname( fileURLToPath( import.meta.url ) );
    const fromModule = findBaseDir( moduleDir );
    return hasPkg( fromModule ) ? fromModule : process.cwd();
  }

  private readCache(): any {
    this.ensureCacheDirectory();
    try {
      const storage = getFileStorage();
      if ( !storage.fileExists( this.cacheFilePath ) ) return {};
      const content = storage.readFile( this.cacheFilePath, "utf-8" );
      if ( !content.trim() ) return {};
      const json = JSON.parse( content );
      return (json && typeof json === "object") ? json : {};
    } catch {
      return {};
    }
  }

  private writeCache(cache: any): void {
    this.ensureCacheDirectory();
    try {
      const serialized = JSON.stringify( cache, null, 2 );
      const storage = getFileStorage();
      storage.writeFile( this.cacheFilePath, serialized, "utf-8" );
    } catch {
      // best-effort cache; ignore write errors
    }
  }

  private getPairKey(base: CurrencyCode, quote: CurrencyCode): string {
    return `${ base }_${ quote }`.toUpperCase();
  }

  private getCacheKey(base: CurrencyCode, quote: CurrencyCode): string {
    return `${ this.providerName }:${ this.getPairKey( base, quote ) }`;
  }

  private getCachedRate(
    base: CurrencyCode,
    quote: CurrencyCode,
    ttlSeconds: number
  ): ExchangeRate | null {
    const cache = this.readCache();
    const providerSection = cache?.[this.providerName];
    if ( !providerSection || typeof providerSection !== "object" ) return null;
    const key = this.getPairKey( base, quote );
    const entry = providerSection[key];
    if ( !entry || typeof entry !== "object" ) return null;
    const cachedAtStr: string | undefined = entry.cachedAt || entry.time;
    if ( !cachedAtStr ) return null;
    const cachedAtMs = Date.parse( cachedAtStr );
    if ( !Number.isFinite( cachedAtMs ) ) return null;
    const ageSeconds = Math.max( 0, Math.floor( (Date.now() - cachedAtMs) / 1000 ) );
    if ( ageSeconds > ttlSeconds ) return null;
    return this.deserializeRate( entry );
  }

  private getStaleCachedRate(base: CurrencyCode, quote: CurrencyCode): ExchangeRate | null {
    const cache = this.readCache();
    const providerSection = cache?.[this.providerName];
    if ( !providerSection || typeof providerSection !== "object" ) return null;
    const key = this.getPairKey( base, quote );
    const entry = providerSection[key];
    if ( !entry || typeof entry !== "object" ) return null;
    return this.deserializeRate( entry );
  }

  private deserializeRate(entry: any): ExchangeRate {
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
    const key = this.getPairKey( rate.base, rate.quote );
    if ( !cache[providerKey] || typeof cache[providerKey] !== "object" ) {
      cache[providerKey] = {};
    }
    cache[providerKey][key] = { ...rate, cachedAt: new Date().toISOString() };
    this.writeCache( cache );
  }

  private getNegativeCached(base: CurrencyCode, quote: CurrencyCode): {
    errorMessage: string;
    statusCode?: number
  } | null {
    const key = this.getCacheKey( base, quote );
    const now = Date.now();
    const neg = this.negativeMemoryCache.get( key );
    if ( neg ) {
      const ageSeconds = Math.max( 0, Math.floor( (now - neg.cachedAtMs) / 1000 ) );
      if ( ageSeconds <= neg.ttlSeconds ) return {
        errorMessage: neg.errorMessage,
        statusCode: neg.statusCode
      };
      this.negativeMemoryCache.delete( key );
    }

    const cache = this.readCache();
    const providerSection = cache?.[this.providerName];
    const negSection = providerSection?._negatives;
    if ( !negSection || typeof negSection !== "object" ) return null;
    const pairKey = this.getPairKey( base, quote );
    const entry = negSection[pairKey];
    if ( !entry ) return null;
    const cachedAtMs = Date.parse( entry.cachedAt );
    const ttlSeconds = Number.isFinite( entry.ttlSeconds )
      ? entry.ttlSeconds
      : this.getNegativeCacheTtlSeconds();
    const ageSeconds = Math.max( 0, Math.floor( (now - cachedAtMs) / 1000 ) );
    if ( Number.isFinite( cachedAtMs ) && ageSeconds <= ttlSeconds ) {
      this.negativeMemoryCache.set( key, {
        errorMessage: String(
          entry.errorMessage
          || entry.message
          || "rate temporarily unavailable"
        ),
        statusCode: Number.isFinite( entry.statusCode ) ? entry.statusCode : undefined,
        cachedAtMs,
        ttlSeconds,
      } );
      return { errorMessage: entry.errorMessage || entry.message, statusCode: entry.statusCode };
    }
    return null;
  }

  private saveNegativeToCache(
    base: CurrencyCode,
    quote: CurrencyCode,
    errorMessage: string,
    statusCode?: number
  ): void {
    const ttlSeconds = this.getNegativeCacheTtlSeconds();
    const key = this.getCacheKey( base, quote );
    this.negativeMemoryCache.set( key, {
      errorMessage,
      statusCode,
      cachedAtMs: Date.now(),
      ttlSeconds
    } );

    const cache = this.readCache();
    if ( !cache[this.providerName] || typeof cache[this.providerName] !== "object" ) {
      cache[this.providerName] = {};
    }
    if ( !cache[this.providerName]._negatives || typeof cache[this.providerName]._negatives !== "object" ) {
      cache[this.providerName]._negatives = {};
    }
    const pairKey = this.getPairKey( base, quote );
    cache[this.providerName]._negatives[pairKey] = {
      errorMessage,
      statusCode,
      cachedAt: new Date().toISOString(),
      ttlSeconds,
    };
    this.writeCache( cache );
  }

  private getEffectiveTtlSeconds(): number {
    const baseTtl = this.cacheValiditySeconds;
    const jitterPercent = this.getTtlJitterPercent();
    if ( jitterPercent <= 0 ) return baseTtl;
    const min = 1 - jitterPercent;
    const max = 1 + jitterPercent;
    const factor = Math.random() * (max - min) + min;
    return Math.max( 1, Math.floor( baseTtl * factor ) );
  }

  private getTtlJitterPercent(): number {
    const raw = (process.env.CUR_CACHE_TTL_JITTER || "0.1").toString().trim();
    const val = Number( raw );
    if ( !Number.isFinite( val ) || val <= 0 ) return 0.0;
    return Math.min( Math.max( val, 0 ), 0.5 );
  }

  private getNegativeCacheTtlSeconds(): number {
    const raw = (process.env.CUR_NEGATIVE_CACHE_TTL_SECONDS || "120").toString().trim();
    const val = Number( raw );
    return Number.isFinite( val ) && val > 0 ? Math.floor( val ) : 120;
  }

  private parseStatusCodeFromError(err: unknown): number | undefined {
    const message = err instanceof Error ? err.message : String( err );
    const m = message.match( /\b(\d{3})\b/ );
    if ( !m ) return undefined;
    const code = Number( m[1] );
    if ( code >= 100 && code <= 599 ) return code;
    return undefined;
  }

  private isCircuitOpen(): boolean {
    const now = Date.now();
    return this.circuitOpenUntilMs > now;
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntilMs = 0;
  }

  private onFailure(): void {
    const threshold = this.getCircuitFailureThreshold();
    const openMs = this.getCircuitOpenMs();
    this.consecutiveFailures += 1;
    if ( this.consecutiveFailures >= threshold ) {
      this.circuitOpenUntilMs = Date.now() + openMs;
      this.consecutiveFailures = 0;
    }
  }

  private getCircuitFailureThreshold(): number {
    const raw = (process.env.CUR_CB_FAILURE_THRESHOLD || "3").toString().trim();
    const val = Number( raw );
    return Number.isFinite( val ) && val > 0 ? Math.floor( val ) : 3;
  }

  private getCircuitOpenMs(): number {
    const raw = (process.env.CUR_CB_OPEN_MS || "30000").toString().trim();
    const val = Number( raw );
    return Number.isFinite( val ) && val > 0 ? Math.floor( val ) : 30000;
  }
}


