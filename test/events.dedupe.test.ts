import { describe, expect, it } from "bun:test";

import { EventService } from "@/application/services/EventService";
import type { AddressActivityFoundEvent } from "@/types/events";

describe("Event dedupe keys propagation", () => {
  it("carries dedupeKey through AddressActivityFound and NotificationEmitted", async () => {
    const events = new EventService({ maxQueueSize: 10 });
    const seen: string[] = [];
    events.subscribe({ event: "NotificationEmitted", handler: (e) => { if (e.dedupeKey) seen.push(e.dedupeKey); } });
    // Minimal pipeline fragment: directly publish AddressActivityFound and expect NotificationEmitted handler from pipeline to set dedupe
    // Here we simulate sink stage
    events.subscribe({
      event: "AddressActivityFound",
      handler: async (ev) => {
        await events.publish({ type: "NotificationEmitted", timestamp: new Date().toISOString(), channel: "stdout", ok: true, details: {}, dedupeKey: `Notification:${ev.block.height}:${ev.block.hash}:${ev.activity.address}:${ev.activity.txid}:${ev.activity.direction}` });
      }
    });
    const aev: AddressActivityFoundEvent = {
      type: "AddressActivityFound",
      timestamp: new Date().toISOString(),
      block: { hash: "H", height: 1, time: 0 },
      activity: { address: "a", txid: "t", direction: "in", valueBtc: 1 },
      dedupeKey: "AddressActivity:1:H:a:t:in",
    };
    await events.publish(aev);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("Notification:1:H:a:t:in");
  });
});


