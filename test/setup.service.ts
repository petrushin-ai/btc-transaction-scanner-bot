import fs from "fs";
import path from "path";

import { BitcoinService } from "@/app/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";

type Fixture = { hex: string; header: { height: number; time: number; hash: string } };

function loadFixture(): Fixture {
  const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
  const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.raw" ) );
  if ( entries.length === 0 ) throw new Error( "No raw fixtures" );
  entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
  const rawPath = path.join( fixturesDir, entries[0] );
  const jsonPath = rawPath.replace( /\.raw$/, ".json" );
  const hex = fs.readFileSync( rawPath, "utf8" ).trim();
  const json = JSON.parse( fs.readFileSync( jsonPath, "utf8" ) );
  return { hex, header: { height: json.height, time: json.time, hash: json.hash } };
}

class PollingRpc extends BitcoinRpcClient {
  private readonly hex: string;
  private readonly header: { height: number; time: number; hash: string };
  private height: number;

  constructor(fix: Fixture) {
    super( { url: "http://127.0.0.1:0" } );
    this.hex = fix.hex;
    this.header = fix.header;
    this.height = 0;
  }

  async getBlockchainInfo(): Promise<any> {
    return { chain: "main", blocks: this.height };
  }

  async getBlockCount(): Promise<number> {
    return this.height;
  }

  async getBlockHash(i: number): Promise<string> {
    if ( i !== this.header.height ) return "";
    return this.header.hash;
  }

  async getBlockRawByHash(_hash: string): Promise<string> {
    return this.hex;
  }

  async getBlockHeader(_hash: string): Promise<any> {
    return { height: this.header.height, time: this.header.time };
  }

  tickToHeight(h: number): void {
    this.height = h;
  }
}

void (async () => {
  const g = globalThis as any;
  if ( g.__RUNNING_SERVICE__ ) return;
  try {
    const fix = loadFixture();
    const rpc = new PollingRpc( fix );
    const svc = new BitcoinService( rpc, { parseRawBlocks: true, pollIntervalMs: 100 } );
    await svc.connect();
    // Start polling loop in background; we never advance height here
    // to keep service in a running/polling state across tests.
    void svc.awaitNewBlock( 0 );
    g.__RUNNING_SERVICE__ = { svc, rpc };
  } catch {
    // ignore setup failures; tests may still run
  }
})();


