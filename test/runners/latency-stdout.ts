import fs from "fs";
import path from "path";

import { BitcoinService } from "@/app/services/BitcoinService";
import { EventService } from "@/app/services/EventService";
import { registerEventPipeline } from "@/app/services/Pipeline";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { ParsedBlock, WatchedAddress } from "@/types/blockchain";

class MockRpc extends BitcoinRpcClient {
  private height: number;
  private readonly nextHash: string;
  private readonly block: ParsedBlock;

  constructor(startHeight: number, nextHash: string, block: ParsedBlock) {
    super( { url: "http://localhost:0" } );
    this.height = startHeight;
    this.nextHash = nextHash;
    this.block = block;
  }

  async getBlockchainInfo(): Promise<any> {
    return { chain: "main" };
  }

  async getBlockCount(): Promise<number> {
    return this.height;
  }

  async getBlockHash(_height: number): Promise<string> {
    return this.nextHash;
  }

  async getBlockByHashVerbose2(_hash: string): Promise<any> {
    return {
      hash: this.block.hash,
      height: this.block.height,
      time: this.block.time,
      tx: this.block.transactions.map( (t) => ({
        txid: t.txid,
        vin: [],
        vout: t.outputs.map( (o) => ({
          value: o.valueBtc,
          scriptPubKey: { address: o.address, type: o.scriptType }
        }) ),
      }) ),
    };
  }

  advanceToNextBlock(): void {
    this.height += 1;
  }
}

function loadLatestParsedBlock(): any {
  const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
  const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.json" ) );
  if ( entries.length === 0 ) throw new Error( "No verbose JSON fixtures found" );
  entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
  return JSON.parse( fs.readFileSync( path.join( fixturesDir, entries[0] ), "utf8" ) );
}

function pickFirstFixtureAddress(blockJson: any): string | undefined {
  for ( const tx of blockJson.tx || [] ) {
    for ( const vout of tx.vout || [] ) {
      const spk = vout.scriptPubKey || {};
      const addresses: string[] | undefined = spk.addresses;
      const addr: string | undefined = Array.isArray( addresses ) ? addresses[0] : spk.address;
      if ( typeof addr === "string" && addr.length > 0 ) return addr;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const verbose = loadLatestParsedBlock();
  const watchedAddr = pickFirstFixtureAddress( verbose );
  if ( !watchedAddr ) throw new Error( "No address found in fixture" );

  const parsedBlock: ParsedBlock = {
    hash: verbose.hash,
    prevHash: verbose.previousblockhash,
    height: verbose.height,
    time: verbose.time,
    transactions: (verbose.tx as any[]).map( (tx: any) => ({
      txid: tx.txid,
      inputs: [],
      outputs: (tx.vout as any[]).map( (vout: any) => {
        const spk = vout.scriptPubKey || {};
        const addresses: string[] | undefined = spk.addresses;
        const addr: string | undefined = Array.isArray( addresses ) ? addresses[0] : spk.address;
        const scriptType: string | undefined = typeof spk.type === "string" ? spk.type : undefined;
        return {
          address: addr,
          valueBtc: Number( vout.value ),
          scriptType,
        } as const;
      } ),
    }) ),
  } as const;

  const startHeight = parsedBlock.height - 1;
  const rpc = new MockRpc( startHeight, parsedBlock.hash, parsedBlock );
  const btc = new BitcoinService( rpc, {
    parseRawBlocks: false,
    resolveInputAddresses: false,
    pollIntervalMs: 50
  } );
  const events = new EventService( { maxQueueSize: 200 } );
  const currencyStub = {
    async getPair() {
      return {
        base: "BTC",
        quote: "USD",
        rate: 0,
        time: new Date().toISOString(),
        source: "test"
      } as any;
    },
    async ping() {
      return {
        provider: "stub",
        ok: true,
        status: "ok",
        checkedAt: new Date().toISOString(),
        latencyMs: 0
      } as any;
    }
  } as any;

  const cfg = {
    bitcoinRpcUrl: "http://localhost:0",
    pollIntervalMs: 50,
    resolveInputAddresses: false,
    parseRawBlocks: false,
    network: "mainnet",
    maxEventQueueSize: 200,
    worker: { id: "worker-1", members: [ "worker-1" ] },
    watch: [ { address: watchedAddr, label: "fixture-1" } ] as WatchedAddress[],
    environment: (process.env.APP_ENV || process.env.NODE_ENV || "production").toString().trim(),
    serviceName: "btc-transaction-scanner-bot",
    logLevel: (process.env.LOG_LEVEL || "info").toString().trim(),
    logPretty: false,
    coinMarketCapApiKey: "",
    sinks: { enabled: [ "stdout" ], stdout: { pretty: false } },
  } as const;

  registerEventPipeline( events as any, { btc: btc as any, currency: currencyStub }, cfg as any );
  await btc.connect();

  const advanceDelayMs = 50;
  setTimeout( () => rpc.advanceToNextBlock(), advanceDelayMs );

  const block = await btc.awaitNewBlock( startHeight );
  const t0 = Date.now();

  // Resolve when first notification is emitted
  const done = new Promise<void>( (resolve) => {
    events.subscribe<any>( {
      event: "NotificationEmitted" as any,
      name: "latency-watch",
      concurrency: 1,
      handler: async (_ev: any) => {
        resolve();
      }
    } );
  } );

  await events.publish( {
    type: "BlockDetected",
    timestamp: new Date().toISOString(),
    height: block.height,
    hash: block.hash,
    prevHash: block.prevHash,
    dedupeKey: `BlockDetected:${ block.height }:${ block.hash }`,
    eventId: `BlockDetected:${ block.height }:${ block.hash }`
  } as any );

  await done;
  const latencyMs = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log( JSON.stringify( { suite: "latency", latencyMs } ) );
}

void main().catch( (err) => {
  // eslint-disable-next-line no-console
  console.error( String( (err as any)?.message || err ) );
  process.exit( 1 );
} );


