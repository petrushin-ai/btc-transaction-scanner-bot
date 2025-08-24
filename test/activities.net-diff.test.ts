import { describe, expect, test } from "bun:test";

import { logActivities } from "@/application/helpers/bitcoin";
import { mapActivitiesWithUsd } from "@/application/helpers/currency";
import { BitcoinService } from "@/application/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import { logger } from "@/infrastructure/logger";
import type { ParsedBlock, WatchedAddress } from "@/types/blockchain";

// Minimal dummy RPC to satisfy constructor; network is not used here
class DummyRpc extends BitcoinRpcClient {
  constructor() {
    super({ url: "http://localhost:0" });
  }
}

describe("Net balance difference logging (both incoming and outgoing)", () => {
  test("emits net value in BTC and USD for mixed-direction tx", () => {
    const watched: WatchedAddress[] = [ { address: "addrA", label: "Wallet A" } ];
    const block: ParsedBlock = {
      hash: "blk_net",
      height: 42,
      time: Math.floor(Date.now() / 1000),
      transactions: [
        {
          txid: "tx_net_1",
          // outgoing from addrA: 1.0 BTC
          inputs: [ { address: "addrA", valueBtc: 1.0 } ],
          // incoming to addrA: 1.5 BTC
          outputs: [ { address: "addrA", valueBtc: 1.5 } ],
        },
      ],
    };

    const rpc = new DummyRpc();
    const svc = new BitcoinService(rpc, { parseRawBlocks: false });

    const acts = svc.checkTransactions(block, watched);
    expect(acts.length).toBe(1);
    // Net should be +0.5 BTC (in - out) with direction "in"
    expect(acts[0]).toMatchObject({
      address: "addrA",
      txid: "tx_net_1",
      direction: "in",
      valueBtc: 0.5
    });

    // Map USD with scripts rate
    const usdRate = 20000; // 1 BTC = $20,000
    const actsUsd = mapActivitiesWithUsd(acts, usdRate);
    expect(actsUsd[0].valueUsd).toBeCloseTo(0.5 * usdRate, 6);

    // Capture log output and verify valueBtc/valueUsd are net values
    const captured: any[] = [];
    const original = (logger as any).info;
    (logger as any).info = (obj: any) => {
      captured.push(obj);
    };
    try {
      logActivities(block, actsUsd);
    } finally {
      (logger as any).info = original;
    }
    expect(captured.length).toBe(1);
    const rec = captured[0];
    expect(rec.type).toBe("transaction.activity");
    expect(rec.blockHeight).toBe(42);
    expect(rec.txid).toBe("tx_net_1");
    expect(rec.address).toBe("addrA");
    expect(rec.direction).toBe("in");
    expect(rec.valueBtc).toBeCloseTo(0.5, 8);
    expect(rec.valueUsd).toBeCloseTo(10000, 2);
  });
});


