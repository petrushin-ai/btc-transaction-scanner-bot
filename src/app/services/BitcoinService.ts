import {
  buildWatchIndexes,
  createAddressBloomFilter,
  type AddressBloomFilter
} from "@/app/helpers/bitcoin";
import { BitcoinRpcClient, Raw } from "@/infrastructure/bitcoin";
import {
  NULL_TXID_64,
  POLL_INTERVAL_MS_DEFAULT,
  PREV_TX_CACHE_MAX_DEFAULT,
} from "@/infrastructure/bitcoin/constants";
import { logger, type AppLogger } from "@/infrastructure/logger";
import type {
  AddressActivity,
  BlockchainService,
  ParsedBlock,
  ParsedTransaction,
  WatchedAddress,
} from "@/types/blockchain";
import type { HealthResult } from "@/types/healthcheck";

import { FeatureFlagsService, type FeatureFlags } from "./FeatureFlagsService";

export type BitcoinServiceOptions = {
  pollIntervalMs?: number;
  resolveInputAddresses?: boolean;
  parseRawBlocks?: boolean;
  network?: Raw.Network;
  flagsService?: FeatureFlagsService;
};

export class BitcoinService implements BlockchainService {
  private readonly pollIntervalMs: number;
  private readonly resolveInputAddresses: boolean;
  private readonly parseRawBlocks: boolean;
  private readonly flagsService?: FeatureFlagsService;
  private readonly verbose: boolean = false;
  private readonly network: Raw.Network = "mainnet";
  private rpc: BitcoinRpcClient;
  private log: AppLogger;
  // cache for watched address structures to avoid rebuilding per tx
  private _watchedCache?: {
    sourceRef: WatchedAddress[] | undefined;
    watchSet: Map<string, string | undefined>;
    labelIndex: Map<string, { address: string; label?: string }[]>;
    bloom?: AddressBloomFilter;
  };
  // LRU-ish cache for previous transactions to minimize repeat RPCs
  private _prevTxCache: Map<string, any> = new Map();
  private _prevTxCacheMax: number = PREV_TX_CACHE_MAX_DEFAULT;

  constructor(rpc: BitcoinRpcClient, opts?: BitcoinServiceOptions) {
    this.rpc = rpc;
    this.pollIntervalMs = opts?.pollIntervalMs ?? POLL_INTERVAL_MS_DEFAULT;
    this.resolveInputAddresses = opts?.resolveInputAddresses ?? false;
    this.parseRawBlocks = opts?.parseRawBlocks ?? false;
    this.flagsService = opts?.flagsService;
    this.verbose = false;
    this.log = logger( "bitcoin_service" );
    if ( opts?.network ) this.network = opts.network;
  }

  /**
   * Precompute immutable watch indexes (address -> label, and label -> addresses) once at startup.
   * Supplying the same array ref later to checkTransactions enables cache reuse without rebuilds.
   */
  setWatchedAddresses(watched: WatchedAddress[]): void {
    const { watchSet, labelIndex, addresses } = buildWatchIndexes( watched );
    const bloom = createAddressBloomFilter( addresses, 0.01 );
    this._watchedCache = { sourceRef: watched, watchSet, labelIndex, bloom };
  }

  private getFlags(): FeatureFlags {
    if ( this.flagsService ) return this.flagsService.getFlags();
    return {
      parseRawBlocks: this.parseRawBlocks,
      resolveInputAddresses: this.resolveInputAddresses
    };
  }

  private isDevelopment(): boolean {
    const env = (process.env.APP_ENV || process.env.NODE_ENV || "development").toString().trim();
    return env === "development";
  }

  private isProduction(): boolean {
    const env = (process.env.APP_ENV || process.env.NODE_ENV || "development").toString().trim();
    return env === "production";
  }

  async connect(): Promise<void> {
    // Ping RPC to ensure connectivity
    await this.rpc.getBlockchainInfo();
  }

  async ping(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const info = await this.rpc.getBlockchainInfo();
      const latencyMs = Date.now() - started;
      return {
        provider: "bitcoin-rpc",
        ok: true,
        status: "ok",
        latencyMs,
        checkedAt: new Date().toISOString(),
        details: { chain: info.chain, blocks: info.blocks },
      };
    } catch ( err ) {
      const latencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String( err );
      return {
        provider: "bitcoin-rpc",
        ok: false,
        status: "error",
        latencyMs,
        checkedAt: new Date().toISOString(),
        details: { error: message },
      };
    }
  }

  async awaitNewBlock(sinceHeight?: number): Promise<ParsedBlock> {
    let current: number = sinceHeight ?? (await this.rpc.getBlockCount());
    const pollStartedAt = Date.now();
    const initialLatest = await this.rpc.getBlockCount();
    if ( this.isDevelopment() || (this.verbose && !this.isProduction()) ) {
      const delta = initialLatest - current;
      this.log.info( {
        type: "poll.start",
        startHeight: current,
        latestHeight: initialLatest,
        behindBlocks: delta,
      } );
    }
    for ( ; ; ) {
      await this.sleep( this.pollIntervalMs );
      const latest = await this.rpc.getBlockCount();
      if ( this.isDevelopment() || (this.verbose && !this.isProduction()) ) {
        const waitedMs = Date.now() - pollStartedAt;
        this.log.info( { type: "poll.tick", heightChecked: latest, waitedMs } );
      }
      if ( latest > current ) {
        const hash = await this.rpc.getBlockHash( latest );
        if ( this.isDevelopment() || (this.verbose && !this.isProduction()) ) {
          const waitedMs = Date.now() - pollStartedAt;
          this.log.info( { type: "poll.new_block", newHeight: latest, waitedMs } );
        }
        return this.parseBlockByHash( hash );
      }
    }
  }

  async parseBlockByHash(blockHash: string): Promise<ParsedBlock> {
    const flags = this.getFlags();
    if ( !flags.parseRawBlocks ) {
      // Prefer verbosity=3 to get vin.prevout and avoid per-input getrawtransaction calls
      let block: any;
      try {
        block = await (this.rpc as any).getBlockByHashVerbose3( blockHash );
      } catch {
        block = await this.rpc.getBlockByHashVerbose2( blockHash );
      }
      return {
        hash: block.hash,
        prevHash: block.previousblockhash,
        height: block.height,
        time: block.time,
        transactions: await this.parseTransactions( block.tx ),
      };
    }
    // Raw path
    const [ hex, header ] = await Promise.all( [
      this.rpc.getBlockRawByHash( blockHash ),
      this.rpc.getBlockHeader( blockHash ),
    ] );
    const rawParsed = Raw.parseRawBlock( hex, this.network );
    const parsed: ParsedBlock = {
      hash: rawParsed.hash,
      prevHash: rawParsed.prevBlock,
      height: header.height,
      time: header.time,
      transactions: rawParsed.transactions.map( (t) => ({
        txid: t.txid,
        inputs: [], // optionally resolved below
        outputs: t.outputs.map( (o) => ({
          address: o.address,
          valueBtc: o.valueBtc,
          scriptType: o.scriptType,
          opReturnDataHex: o.opReturnDataHex,
          opReturnUtf8: o.opReturnDataHex ? tryDecodeUtf8( o.opReturnDataHex ) : undefined,
        }) ),
      }) ),
    };
    // Do not resolve inputs in raw path to avoid additional RPCs; inputs remain empty.
    return parsed;
  }

  /**
   * Lightweight parse: fetch the tip block header/hash and transactions via the chosen path once.
   * Useful for startup scanning without entering the await loop.
   */
  async parseLatestBlockOnce(): Promise<ParsedBlock> {
    const height = await this.rpc.getBlockCount();
    const hash = await this.rpc.getBlockHash( height );
    return this.parseBlockByHash( hash );
  }

  checkTransactions(block: ParsedBlock, watched: WatchedAddress[]): AddressActivity[] {
    let watchSet: Map<string, string | undefined>;
    let labelIndex: Map<string, { address: string; label?: string }[]>;
    let bloom: AddressBloomFilter | undefined;
    // Prefer prebuilt cache when available, and the same source list is used
    if ( this._watchedCache && this._watchedCache.sourceRef === watched ) {
      watchSet = this._watchedCache.watchSet;
      labelIndex = this._watchedCache.labelIndex;
      bloom = this._watchedCache.bloom;
    } else if ( this._watchedCache && (!watched || watched.length === 0) ) {
      // If the caller intentionally passes an empty list (or undefined in future), use prebuilt
      watchSet = this._watchedCache.watchSet;
      labelIndex = this._watchedCache.labelIndex;
      bloom = this._watchedCache.bloom;
    } else {
      // Build a scoped cache for the provided watched list
      const built = buildWatchIndexes( watched );
      watchSet = built.watchSet;
      labelIndex = built.labelIndex;
      const addresses = built.addresses;
      bloom = createAddressBloomFilter( addresses, 0.01 );
      this._watchedCache = { sourceRef: watched, watchSet, labelIndex, bloom };
    }

    const activities: AddressActivity[] = [];
    // Reuse scratch structures across tx iterations to reduce per-tx allocations
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    const matchedAddressesThisTx = new Set<string>();

    for ( const tx of block.transactions ) {
      // collect OP_RETURN data if present in this tx (first seen wins)
      let opReturnHex: string | undefined;
      let opReturnUtf8: string | undefined;
      for ( const out of tx.outputs ) {
        if ( out.scriptType === "nulldata" && (out.opReturnDataHex || out.opReturnUtf8) ) {
          opReturnHex = opReturnHex || out.opReturnDataHex;
          opReturnUtf8 = opReturnUtf8 || (out as any).opReturnUtf8;
        }
      }
      // Clear scratch structures for this tx
      incoming.clear();
      outgoing.clear();
      matchedAddressesThisTx.clear();

      for ( const out of tx.outputs ) {
        const addr = out.address;
        if ( !addr ) continue;
        if ( bloom && !bloom.mightContain( addr ) ) continue;
        if ( !watchSet.has( addr ) ) continue;
        incoming.set( addr, (incoming.get( addr ) || 0) + out.valueBtc );
      }
      // Only available when resolveInputAddresses is true
      for ( const input of tx.inputs ) {
        const addr = input.address;
        if ( !addr || !input.valueBtc ) continue;
        if ( bloom && !bloom.mightContain( addr ) ) continue;
        if ( !watchSet.has( addr ) ) continue;
        outgoing.set( addr, (outgoing.get( addr ) || 0) + input.valueBtc );
      }

      // Emit net activities without building a union Set
      for ( const [ addr, inSum ] of incoming ) {
        const outSum = outgoing.get( addr ) || 0;
        if ( inSum > 0 && outSum > 0 ) {
          const net = inSum - outSum;
          if ( net !== 0 ) {
            activities.push( {
              address: addr,
              label: watchSet.get( addr ),
              txid: tx.txid,
              direction: net >= 0 ? "in" : "out",
              valueBtc: Math.abs( net ),
            } );
            matchedAddressesThisTx.add( addr );
          }
        } else if ( inSum > 0 ) {
          activities.push( {
            address: addr,
            label: watchSet.get( addr ),
            txid: tx.txid,
            direction: "in",
            valueBtc: inSum,
          } );
          matchedAddressesThisTx.add( addr );
        }
      }
      for ( const [ addr, outSum ] of outgoing ) {
        if ( matchedAddressesThisTx.has( addr ) ) continue;
        if ( outSum > 0 ) {
          activities.push( {
            address: addr,
            label: watchSet.get( addr ),
            txid: tx.txid,
            direction: "out",
            valueBtc: outSum,
          } );
          matchedAddressesThisTx.add( addr );
        }
      }

      // Label-based matching via OP_RETURN text: if OP_RETURN contains a watched label,
      // emit a zero-value activity for the associated watched address (if not already matched).
      if ( opReturnUtf8 && labelIndex.size > 0 ) {
        const opLower = opReturnUtf8.toLowerCase();
        for ( const [ labelKey, items ] of labelIndex ) {
          if ( !labelKey ) continue;
          if ( opLower.includes( labelKey ) ) {
            for ( const item of items ) {
              if ( matchedAddressesThisTx.has( item.address ) ) continue;
              if ( bloom && !bloom.mightContain( item.address ) ) continue;
              if ( !watchSet.has( item.address ) ) continue;
              activities.push( {
                address: item.address,
                label: item.label,
                txid: tx.txid,
                direction: "in",
                valueBtc: 0,
              } );
              matchedAddressesThisTx.add( item.address );
            }
          }
        }
      }
    }
    return activities;
  }

  private async parseTransactions(rawTxs: any[]): Promise<ParsedTransaction[]> {
    const parsed: ParsedTransaction[] = [];
    let prevMap: Map<string, any> | undefined; // intentionally unused; no prev-tx RPCs
    const flags = this.getFlags();
    // Only resolve inputs when prevout is inline (verbosity=3). No getrawtransaction fallback.
    const hasPrevoutInline = Array.isArray(
      rawTxs
    ) && rawTxs
      .some( (t: any) => Array.isArray( t.vin ) && t.vin.some( (v: any) => v && v.prevout ) );
    for ( const tx of rawTxs ) {
      const outputs = (tx.vout as any[]).map( (vout) => {
        const spk = vout.scriptPubKey || {};
        const addresses: string[] | undefined = spk.addresses;
        const addr: string | undefined = Array.isArray( addresses ) ? addresses[0] : spk.address;
        const scriptType: string | undefined = typeof spk.type === "string" ? spk.type : undefined;
        // Extract OP_RETURN data when present via an asm pattern
        let opReturnDataHex: string | undefined;
        let opReturnUtf8: string | undefined;
        const asm: string | undefined = typeof spk.asm === "string" ? spk.asm : undefined;
        if ( scriptType === "nulldata" && asm ) {
          const parts = asm.split( /\s+/ );
          const dataHex = parts.length >= 2 && parts[0] === "OP_RETURN" ? parts[1] : undefined;
          if ( dataHex && /^[0-9a-fA-F]+$/.test( dataHex ) ) {
            opReturnDataHex = dataHex.toLowerCase();
            try {
              const bytes = Buffer.from( opReturnDataHex, "hex" );
              const text = new TextDecoder().decode( bytes );
              const printable = /[\x09\x0A\x0D\x20-\x7E]/.test( text );
              opReturnUtf8 = printable ? text : undefined;
            } catch {
              // ignore decoding errors
            }
          }
        }
        return {
          address: addr,
          valueBtc: Number( vout.value ),
          scriptType,
          opReturnDataHex,
          opReturnUtf8,
        };
      } );

      const inputs: { address?: string; valueBtc?: number }[] = [];
      if ( flags.resolveInputAddresses ) {
        for ( const vin of tx.vin as any[] ) {
          if ( vin.coinbase ) {
            inputs.push( {} );
            continue;
          }
          // Prefer inline prevout (verbosity=3)
          const prevOutInline = (vin as any).prevout;
          if ( prevOutInline ) {
            const spk = prevOutInline.scriptPubKey || {};
            const addresses: string[] | undefined = spk.addresses;
            const addr: string | undefined = Array.isArray( addresses ) ? addresses[0] : spk.address;
            inputs.push( { address: addr, valueBtc: Number( prevOutInline.value ) } );
            continue;
          }
          // No prevout available; skip input resolution to avoid extra RPCs
          inputs.push( {} );
        }
      }

      parsed.push( {
        txid: tx.txid,
        inputs,
        outputs,
      } );
    }
    return parsed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise( (resolve) => setTimeout( resolve, ms ) );
  }

  private async getPrevTransactions(txids: string[]): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    const missing: string[] = [];
    for ( const id of txids ) {
      const cached = this._prevTxCache.get( id );
      if ( cached ) {
        result.set( id, cached );
      } else {
        missing.push( id );
      }
    }
    if ( missing.length > 0 ) {
      try {
        const fetched = (await (this.rpc as any).getRawTransactionVerboseBatch( missing )) as any[];
        for ( let i = 0; i < missing.length; i++ ) {
          const id = missing[i];
          const val = fetched[i];
          if ( !val ) continue;
          result.set( id, val );
          this._prevTxCache.set( id, val );
          if ( this._prevTxCache.size > this._prevTxCacheMax ) {
            const firstIt = this._prevTxCache.keys().next();
            if ( !firstIt.done ) this._prevTxCache.delete( firstIt.value as string );
          }
        }
      } catch {
        // Fallback to individual calls if the batch is unsupported
        for ( const id of missing ) {
          try {
            const val = (await this.rpc.getRawTransactionVerbose( id )) as any;
            result.set( id, val );
            this._prevTxCache.set( id, val );
            if ( this._prevTxCache.size > this._prevTxCacheMax ) {
              const firstIt = this._prevTxCache.keys().next();
              if ( !firstIt.done ) this._prevTxCache.delete( firstIt.value as string );
            }
          } catch {
            // ignore
          }
        }
      }
    }
    return result;
  }
}

function tryDecodeUtf8(hex: string): string | undefined {
  try {
    const buf = Buffer.from( hex, "hex" );
    const text = new TextDecoder().decode( buf );
    const printable = /[\x09\x0A\x0D\x20-\x7E]/.test( text );
    return printable ? text : undefined;
  } catch {
    return undefined;
  }
}

