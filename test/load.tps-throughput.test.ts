import { describe, expect, test } from "bun:test";

import { BitcoinService } from "@/application/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { ParsedBlock, WatchedAddress } from "@/types/blockchain";

import { emitMetric } from "./_metrics";

class MockRpc extends BitcoinRpcClient {
  private blocks: ParsedBlock[];
  private height: number;

  constructor(blocks: ParsedBlock[]) {
    super({ url: "http://localhost:0" });
    this.blocks = blocks;
    this.height = 0;
  }

  async getBlockchainInfo(): Promise<any> {
    return { chain: "main" };
  }

  async getBlockCount(): Promise<number> {
    return this.height;
  }

  async getBlockHash(idx: number): Promise<string> {
    return this.blocks[idx - 1]?.hash ?? "";
  }

  async getBlockByHashVerbose2(hash: string): Promise<any> {
    const block = this.blocks.find((b) => b.hash === hash)!;
    return {
      hash: block.hash,
      height: block.height,
      time: block.time,
      tx: block.transactions.map((t) => ({
        txid: t.txid,
        vin: [],
        vout: t.outputs.map((o) => ({ value: o.valueBtc, scriptPubKey: { address: o.address, type: o.scriptType } })),
      })),
    };
  }

  tick(): void {
    if (this.height < this.blocks.length) this.height += 1;
  }
}

function makeBlocks(tps: number, durationSeconds: number, watched: WatchedAddress[]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let txCounter = 0;
  for (let sec = 0; sec < durationSeconds; sec++) {
    const txs = Array.from({ length: tps }, () => ({
      txid: `tx_${tps}_${sec}_${txCounter++}`,
      inputs: [],
      outputs: watched.slice(0, 1).map((w) => ({ address: w.address, valueBtc: 0.0001 })),
    }));
    blocks.push({
      hash: `blk_${tps}_${sec}`,
      height: sec + 1,
      time: Math.floor(Date.now() / 1000) + sec,
      transactions: txs,
    });
  }
  return blocks;
}

describe("Throughput (TPS) load test", () => {
  test("ramp TPS and measure sustained throughput", async () => {
    const watched: WatchedAddress[] = Array.from({ length: 1000 }, (_, i) => ({ address: `addr_${i}` }));
    const levels = [5, 10, 20, 50];
    const durationSeconds = 2;

    let maxMeasured = 0;
    let baselineMeasured10 = 0;

    for (const tps of levels) {
      const blocks = makeBlocks(tps, durationSeconds, watched);
      const rpc = new MockRpc(blocks);
      const svc = new BitcoinService(rpc, { parseRawBlocks: false, pollIntervalMs: 1 });
      await svc.connect();

      const expectedTx = blocks.reduce((acc, b) => acc + b.transactions.length, 0);

      let processedTx = 0;
      const t0 = performance.now();
      for (let i = 0; i < blocks.length; i++) {
        rpc.tick();
        const blk = await svc.awaitNewBlock(i);
        const acts = svc.checkTransactions(blk, watched);
        processedTx += blk.transactions.length;
        // Touch activities to avoid DCE
        if (acts.length < 0) throw new Error("unreachable");
      }
      const elapsedMs = performance.now() - t0;
      const measuredTps = processedTx / (elapsedMs / 1000);
      maxMeasured = Math.max(maxMeasured, measuredTps);
      if (tps === 10) baselineMeasured10 = measuredTps;

      // Do not emit per-level measured TPS metrics; keep only the max across levels

      // Sanity: we should process all tx generated
      expect(processedTx).toBe(expectedTx);
    }

    emitMetric({ suite: "throughput", name: "max_measured_tps", value: Math.round(maxMeasured), unit: "tps" });

    // Baseline assertion: ensure at least ~7 TPS capacity under 1000 watched addresses
    expect(baselineMeasured10).toBeGreaterThanOrEqual(7);
  });
});


