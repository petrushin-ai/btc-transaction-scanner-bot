import { describe, expect, it } from "bun:test";

import { EventService } from "@/application/services/EventService";
import { registerEventPipeline } from "@/application/services/Pipeline";

// Minimal fakes for services used by pipeline
const fakeBtcService = {
  async parseBlockByHash(hash: string) {
    return { hash, height: 100, time: 123, transactions: [] } as any;
  },
  checkTransactions(_block: any, _watch: any[]) {
    return [
      { address: "a1", txid: "t1", direction: "in", valueBtc: 1 },
      { address: "a2", txid: "t2", direction: "out", valueBtc: 0.5 },
    ] as any[];
  },
};

const fakeCurrencyService = {
  async getPair() {
    return { rate: 1000 } as any;
  },
};

describe("Pipeline integration", () => {
  it("flows BlockDetected -> BlockParsed -> AddressActivityFound -> NotificationEmitted", async () => {
    const events = new EventService({ maxQueueSize: 10 });
    const btc = fakeBtcService as any;
    const currency = fakeCurrencyService as any;
    const cfg = { watch: [], worker: { id: "w1", members: ["w1"] } } as any;

    let sawParsed = false;
    let sawActivity = 0;
    let sawNotification = 0;

    // Tap events
    events.subscribe({ event: "BlockParsed", handler: () => { sawParsed = true; } });
    events.subscribe({ event: "AddressActivityFound", handler: () => { sawActivity += 1; } });
    events.subscribe({ event: "NotificationEmitted", handler: () => { sawNotification += 1; } });

    registerEventPipeline(events as any, { btc, currency }, cfg);

    await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: 1, hash: "H", dedupeKey: "BlockDetected:1:H" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sawParsed).toBe(true);
    expect(sawActivity).toBeGreaterThanOrEqual(2);
    expect(sawNotification).toBeGreaterThanOrEqual(2);
  });
});


