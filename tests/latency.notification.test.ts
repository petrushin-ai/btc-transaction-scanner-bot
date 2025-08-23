import { describe, expect, test } from "bun:test";

import { BitcoinService } from "@/application/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { ParsedBlock } from "@/types/blockchain";

import { emitMetric } from "./_metrics";

// Mock RPC that simulates a new block appearing after a short delay
class MockRpc extends BitcoinRpcClient {
  private height: number;
  private nextHash: string;
  private block: ParsedBlock;
  constructor(startHeight: number, nextHash: string, block: ParsedBlock) {
    // @ts-expect-error allow empty
    super({ url: "http://localhost:0" });
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
  async getBlockHash(height: number): Promise<string> {
    return this.nextHash;
  }
  async getBlockByHashVerbose2(_hash: string): Promise<any> {
    return {
      hash: this.block.hash,
      height: this.block.height,
      time: this.block.time,
      tx: this.block.transactions.map((t) => ({
        txid: t.txid,
        vin: [],
        vout: t.outputs.map((o) => ({ value: o.valueBtc, scriptPubKey: { address: o.address, type: o.scriptType } })),
      })),
    };
  }
  // Helpers to advance chain
  advanceToNextBlock(): void {
    this.height += 1;
  }
}

describe("Notification latency", () => {
  test("block discovery to processing under 5s", async () => {
    // Minimal block shape
    const block: ParsedBlock = {
      hash: "h",
      height: 100,
      time: Math.floor(Date.now() / 1000),
      transactions: [
        { txid: "t", inputs: [], outputs: [{ valueBtc: 0.1, address: "a" }] },
      ],
    };
    const rpc = new MockRpc(10, "h", block);
    const svc = new BitcoinService(rpc, { parseRawBlocks: false, pollIntervalMs: 100 });
    await svc.connect();

    const start = Date.now();
    // simulate new block appears shortly after
    setTimeout(() => rpc.advanceToNextBlock(), 200);
    const got = await svc.awaitNewBlock(10);
    const latencyMs = Date.now() - start;

    emitMetric({ suite: "latency", name: "block_discovery_to_processing_ms", value: latencyMs, unit: "ms" });
    expect(got.height).toBe(block.height);
    expect(latencyMs).toBeLessThanOrEqual(5000);
  });
});


