import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";

import { BitcoinService } from "@/application/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { WatchedAddress } from "@/types/blockchain";

import { emitMetric } from "./_metrics";

// Minimal dummy RPC to satisfy constructor; we won't call network in this test
class DummyRpc extends BitcoinRpcClient {
  constructor() {
    super({ url: "http://localhost:0" });
  }
}

function loadAddresses(limit: number): WatchedAddress[] {
  const p = path.join(process.cwd(), "addresses.json");
  const raw = fs.readFileSync(p, "utf8");
  const arr = JSON.parse(raw) as { address: string; label?: string }[];
  return arr.slice(0, limit).map((x) => ({ address: x.address, label: x.label }));
}

function loadLatestParsedBlock(): any {
  const fixturesDir = path.join(process.cwd(), "test", "fixtures");
  const entries = fs.readdirSync(fixturesDir).filter((f) => f.endsWith("-current.json"));
  if (entries.length === 0) throw new Error("No verbose JSON fixtures found");
  entries.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, entries[0]), "utf8"));
}

describe("Transaction matching performance", () => {
  test("checkTransactions with 1000 addresses under time budget", async () => {
    const addresses = loadAddresses(1000);
    // Build a ParsedBlock using verbose fixture via service path (inputs empty)
    const rpc = new DummyRpc();
    const svc = new BitcoinService(rpc, { resolveInputAddresses: false, parseRawBlocks: false });

    const verbose = loadLatestParsedBlock();
    const block = {
      hash: verbose.hash,
      height: verbose.height,
      time: verbose.time,
      transactions: await (svc as any)["parseTransactions"](verbose.tx),
    } as const;

    const t0 = performance.now();
    const activities = svc.checkTransactions(block as any, addresses);
    const t1 = performance.now();

    expect(Array.isArray(activities)).toBe(true);
    emitMetric({
      suite: "matching",
      name: "check_1000_addresses_ms",
      value: Math.round(t1 - t0),
      unit: "ms",
      details: { activities: activities.length }
    });
    // Time budget: aim for < 50ms on a typical machine
    expect(t1 - t0).toBeLessThan(50);
  });
});


