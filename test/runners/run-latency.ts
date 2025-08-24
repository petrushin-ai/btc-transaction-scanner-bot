import { BitcoinService } from "src/application/services/BitcoinService";
import { BitcoinRpcClient } from "src/infrastructure/bitcoin";
import type { ParsedBlock } from "src/types/blockchain";

class MockRpc extends BitcoinRpcClient {
  private height: number;
  private nextHash: string;
  private block: ParsedBlock;

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

export async function measureLatency() {
  const block: ParsedBlock = {
    hash: "h",
    height: 100,
    time: Math.floor( Date.now() / 1000 ),
    transactions: [ { txid: "t", inputs: [], outputs: [ { valueBtc: 0.1, address: "a" } ] } ],
  };
  const startHeight = 10;
  const rpc = new MockRpc( startHeight, "h", block );
  const svc = new BitcoinService( rpc, { parseRawBlocks: false, pollIntervalMs: 100 } );
  await svc.connect();

  const t0 = Date.now();
  setTimeout( () => rpc.advanceToNextBlock(), 200 );
  await svc.awaitNewBlock( startHeight );
  const latencyMs = Date.now() - t0;
  return { suite: "proc-latency", latencyMs };
}

if (import.meta.main) {
  measureLatency().then((data) => {
    console.log(JSON.stringify(data));
  }).catch((err) => {
    console.error(String((err as any)?.message || err));
    process.exit(1);
  });
}


