import { describe, expect, test } from "bun:test";

import { logActivities, logOpReturnData } from "@/application/helpers/bitcoin";
import { logger } from "@/infrastructure/logger";
import type { ParsedBlock } from "@/types/blockchain";

describe("Logging output", () => {
  test("logActivities emits transaction.activity with required fields", () => {
    const block: ParsedBlock = {
      hash: "blk",
      height: 1,
      time: Math.floor(Date.now() / 1000),
      transactions: [
        {
          txid: "tx1",
          inputs: [],
          outputs: [
            { address: "addr1", valueBtc: 0.01 },
          ],
        },
      ],
    };
    const activities = [
      { address: "addr1", label: "L1", txid: "tx1", direction: "in" as const, valueBtc: 0.01, valueUsd: 100 },
    ];

    const captured: any[] = [];
    const original = (logger as any).info;
    (logger as any).info = (obj: any) => { captured.push(obj); };
    try {
      logActivities(block, activities);
    } finally {
      (logger as any).info = original;
    }

    expect(captured.length).toBe(1);
    const rec = captured[0];
    expect(rec.type).toBe("transaction.activity");
    expect(rec.blockHeight).toBe(block.height);
    expect(rec.blockHash).toBe(block.hash);
    expect(rec.txid).toBe("tx1");
    expect(rec.address).toBe("addr1");
    expect(rec.direction).toBe("in");
    expect(rec.valueBtc).toBe(0.01);
    expect(rec.valueUsd).toBe(100);
  });

  test("logOpReturnData emits transaction.op_return when present", () => {
    const block: ParsedBlock = {
      hash: "blk",
      height: 2,
      time: Math.floor(Date.now() / 1000),
      transactions: [
        {
          txid: "tx2",
          inputs: [],
          outputs: [
            { valueBtc: 0, scriptType: "nulldata", opReturnDataHex: "74657374", opReturnUtf8: "test" },
          ],
        },
      ],
    };

    const captured: any[] = [];
    const original = (logger as any).debug;
    (logger as any).debug = (obj: any) => { captured.push(obj); };
    try {
      logOpReturnData(block);
    } finally {
      (logger as any).debug = original;
    }

    expect(captured.length).toBe(1);
    const rec = captured[0];
    expect(rec.type).toBe("transaction.op_return");
    expect(rec.blockHeight).toBe(2);
    expect(rec.blockHash).toBe("blk");
    expect(rec.txid).toBe("tx2");
    expect(rec.opReturnHex).toBe("74657374");
    expect(rec.opReturnUtf8).toBe("test");
  });
});


