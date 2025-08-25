import { setTimeout as delay } from "timers/promises";

import { BitcoinService } from "@/app/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { ParsedBlock, WatchedAddress } from "@/types/blockchain";

function memMb(): number {
  const { rss } = process.memoryUsage();
  return Math.round( (rss / (1024 * 1024)) * 100 ) / 100;
}

class SoakRpc extends BitcoinRpcClient {
  private blocks: ParsedBlock[];
  private idx: number;

  constructor(blocks: ParsedBlock[]) {
    super( { url: "http://127.0.0.1:0" } );
    this.blocks = blocks;
    this.idx = 0;
  }

  async getBlockchainInfo(): Promise<any> {
    return { chain: "main" };
  }

  async getBlockCount(): Promise<number> {
    return this.idx;
  }

  async getBlockHash(i: number): Promise<string> {
    return this.blocks[i - 1]?.hash ?? "";
  }

  async getBlockByHashVerbose2(hash: string): Promise<any> {
    const block = this.blocks.find( (b) => b.hash === hash )!;
    return {
      hash: block.hash,
      height: block.height,
      time: block.time,
      tx: block.transactions.map( (t) => ({
        txid: t.txid,
        vin: [],
        vout: t.outputs
          .map( (o) =>
            ({ value: o.valueBtc, scriptPubKey: { address: o.address, type: o.scriptType } }) ),
      }) ),
    };
  }

  tick(): void {
    this.idx = Math.min( this.idx + 1, this.blocks.length );
  }
}

function makeSoakBlocks(tps: number, seconds: number, watched: WatchedAddress[]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let txId = 0;
  for ( let sec = 0; sec < seconds; sec++ ) {
    const txs = Array.from( { length: tps }, () => ({
      txid: `tx_${ sec }_${ txId++ }`,
      inputs: [],
      outputs: watched.slice( 0, 1 ).map( (w) => ({ address: w.address, valueBtc: 0.00001 }) ),
    }) );
    blocks.push( {
      hash: `blk_${ sec }`,
      height: sec + 1,
      time: Math.floor( Date.now() / 1000 ) + sec,
      transactions: txs
    } );
  }
  return blocks;
}

export async function runSoak(secondsInput?: number) {
  const tps = 10;
  const durationSeconds = Number( secondsInput ?? process.env.SOAK_SECONDS ?? 60 );
  const watched: WatchedAddress[] = Array.from( { length: 1000 }, (_, i) => ({ address: `addr_${ i }` }) );

  const blocks = makeSoakBlocks( tps, durationSeconds, watched );
  const rpc = new SoakRpc( blocks );
  const svc = new BitcoinService( rpc, { parseRawBlocks: false, pollIntervalMs: 1 } );
  await svc.connect();

  const idleMb = memMb();
  let maxMb = idleMb;
  const latencies: number[] = [];

  const t0 = performance.now();
  for ( let i = 0; i < blocks.length; i++ ) {
    const bStart = performance.now();
    rpc.tick();
    const blk = await svc.awaitNewBlock( i );
    const acts = svc.checkTransactions( blk, watched );
    if ( acts.length < 0 ) throw new Error( "unreachable" );
    const bEnd = performance.now();
    latencies.push( bEnd - bStart );
    maxMb = Math.max( maxMb, memMb() );
    // simulate 10 TPS pacing (1s blocks with 10 tx each)
    await delay( 1 );
  }
  const t1 = performance.now();

  const totalTx = blocks.reduce( (a, b) => a + b.transactions.length, 0 );
  const totalSeconds = (t1 - t0) / 1000;
  const tpsMeasured = totalTx / totalSeconds;
  const p95Latency = latencies
    .slice()
    .sort( (a, b) => a - b )[Math.floor( 0.95 * (latencies.length - 1) )];

  return {
    suite: "proc-soak",
    seconds: durationSeconds,
    tpsTarget: tps,
    tpsMeasured: Math.round( tpsMeasured ),
    rssIdleMb: idleMb,
    rssMaxMb: maxMb,
    rssDeltaMb: Math.round( (maxMb - idleMb) * 100 ) / 100,
    p95BlockLatencyMs: Math.round( p95Latency ),
  };
}

if ( import.meta.main ) {
  runSoak().then( (data) => {
    console.log( JSON.stringify( data ) );
  } ).catch( (err) => {
    console.error( String( (err as any)?.message || err ) );
    process.exit( 1 );
  } );
}


