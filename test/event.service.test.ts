import { describe, expect, it } from "bun:test";

import { EventService } from "@/application/services/EventService";
import type { DomainEvent } from "@/types/events";

function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

describe("EventService", () => {
  it("delivers events to subscribers", async () => {
    const events = new EventService({ maxQueueSize: 10 });
    const received: DomainEvent[] = [];
    events.subscribe({ event: "BlockDetected", handler: (e) => { received.push(e); } });
    await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: 1, hash: "h", dedupeKey: "BlockDetected:1:h" });
    await wait(5);
    expect(received.length).toBe(1);
    expect((received[0] as any).height).toBe(1);
  });

  it("respects concurrency per subscription", async () => {
    const events = new EventService({ maxQueueSize: 100 });
    let maxActive = 0;
    let active = 0;
    events.subscribe({
      event: "BlockDetected",
      concurrency: 2,
      handler: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await wait(20);
        active -= 1;
      },
    });
    for (let i = 0; i < 5; i++) {
      await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: i, hash: String(i), dedupeKey: `BlockDetected:${i}:${String(i)}` });
    }
    await wait(150);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("applies retry policy on handler failure", async () => {
    const events = new EventService({ maxQueueSize: 10 });
    let attempts = 0;
    events.subscribe({
      event: "BlockDetected",
      retry: { maxRetries: 2, backoffMs: () => 1 },
      handler: async () => {
        attempts += 1;
        throw new Error("boom");
      },
    });
    await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: 1, hash: "h", dedupeKey: "BlockDetected:1:h" });
    await wait(20);
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("exerts backpressure when queue is full", async () => {
    const events = new EventService({ maxQueueSize: 1 });
    let handled = 0;
    events.subscribe({ event: "BlockDetected", handler: async () => { await wait(30); handled += 1; } });
    const t0 = Date.now();
    await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: 1, hash: "h1", dedupeKey: "BlockDetected:1:h1" });
    // the second publish should wait until the first drains because queue size is 1 and handler is slow
    await events.publish({ type: "BlockDetected", timestamp: new Date().toISOString(), height: 2, hash: "h2", dedupeKey: "BlockDetected:2:h2" });
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(25);
    await wait(50);
    expect(handled).toBeGreaterThanOrEqual(2);
  });
});


