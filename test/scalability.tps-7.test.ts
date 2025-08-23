import {describe, expect, test} from "bun:test";

import {BitcoinService} from "@/application/services/BitcoinService";
import {BitcoinRpcClient} from "@/infrastructure/bitcoin";
import type {ParsedBlock, WatchedAddress} from "@/types/blockchain";

import {emitMetric} from "./_metrics";

class MockRpcTps extends BitcoinRpcClient {
    private blocks: ParsedBlock[];
    private height: number;

    constructor(blocks: ParsedBlock[]) {
        super({url: "http://localhost:0"});
        this.blocks = blocks;
        this.height = 0;
    }

    async getBlockchainInfo(): Promise<any> {
        return {chain: "main"};
    }

    async getBlockCount(): Promise<number> {
        return this.height;
    }

    async getBlockHash(idx: number): Promise<string> {
        return this.blocks[idx - 1]?.hash ?? ""; // heights start at 1 here
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
                vout: t.outputs
                    .map(
                        (o) =>
                            ({
                                value: o.valueBtc,
                                scriptPubKey: {address: o.address, type: o.scriptType}
                            })
                    ),
            })),
        };
    }

    tick(): void {
        if (this.height < this.blocks.length) this.height += 1;
    }
}

function makeBlocks(
    tps: number,
    durationSeconds: number,
    watched: WatchedAddress[]
): ParsedBlock[] {
    // Approximate: group transactions into 1-second blocks with tps transactions each
    const blocks: ParsedBlock[] = [];
    let txCounter = 0;
    for (let sec = 0; sec < durationSeconds; sec++) {
        const txs = Array.from({length: tps}, () => ({
            txid: `tx_${txCounter++}`,
            inputs: [],
            outputs: watched.slice(0, 1).map((w) => ({address: w.address, valueBtc: 0.0001})),
        }));
        blocks.push({
            hash: `blk_${sec}`,
            height: sec + 1,
            time: Math.floor(Date.now() / 1000) + sec,
            transactions: txs,
        });
    }
    return blocks;
}

describe("Scalability", () => {
    test("1000 addresses and sustained 7 TPS", async () => {
        const watched: WatchedAddress[] = Array.from({length: 1000}, (_, i) => ({address: `addr_${i}`}));
        const blocks = makeBlocks(7, 10, watched); // 10 seconds at 7 TPS => 70 tx total
        const rpc = new MockRpcTps(blocks);
        const svc = new BitcoinService(rpc, {parseRawBlocks: false, pollIntervalMs: 5});
        await svc.connect();

        // Iterate through all blocks simulating 1 block per second
        let totalActivities = 0;
        const start = performance.now();
        for (let i = 0; i < blocks.length; i++) {
            rpc.tick();
            const blk = await svc.awaitNewBlock(i);
            const acts = svc.checkTransactions(blk, watched);
            totalActivities += acts.length;
        }
        const totalMs = performance.now() - start;
        emitMetric({
            suite: "scalability",
            name: "process_7tps_10s_total_ms",
            value: Math.round(totalMs),
            unit: "ms",
            details: {totalActivities}
        });

        expect(totalActivities).toBeGreaterThan(0);
    });
});


