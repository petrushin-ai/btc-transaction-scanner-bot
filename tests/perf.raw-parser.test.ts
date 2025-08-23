import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { Raw } from "@/infrastructure/bitcoin";
import { emitMetric, memoryUsageMb } from "./_metrics";

function readHex(filePath: string): string {
  const hex = fs.readFileSync(filePath, "utf8").trim();
  return hex;
}

describe("Raw parser performance", () => {
  test("parse latest fixture block within time and memory budget", () => {
    const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
    const entries = fs.readdirSync(fixturesDir).filter((f) => f.endsWith("-current.raw"));
    if (entries.length === 0) {
      throw new Error("No *.raw fixtures found");
    }
    // pick the numerically highest height
    entries.sort((a, b) => {
      const ha = Number(a.split("-")[1]);
      const hb = Number(b.split("-")[1]);
      return hb - ha;
    });
    const hex = readHex(path.join(fixturesDir, entries[0]));

    const memBefore = memoryUsageMb();
    const t0 = performance.now();
    const block = Raw.parseRawBlock(hex, "mainnet");
    const t1 = performance.now();
    const memAfter = memoryUsageMb();

    // Sanity
    expect(block.transactions.length).toBeGreaterThan(0);

    const parseMs = t1 - t0;
    const memDelta = memAfter - memBefore;

    emitMetric({
      suite: "raw-parser",
      name: "parse_block_ms",
      value: Math.round(parseMs),
      unit: "ms",
      details: { txCount: block.transactions.length },
    });
    emitMetric({
      suite: "raw-parser",
      name: "mem_delta_mb",
      value: Math.round(memDelta * 100) / 100,
      unit: "MB",
    });

    // Budgets: keep generous to avoid CI flakiness, adjust later if needed
    expect(parseMs).toBeLessThan(500); // < 0.5s to parse one block
    expect(memDelta).toBeLessThan(100); // < 100 MB additional RSS
  });
});


