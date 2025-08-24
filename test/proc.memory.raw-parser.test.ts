import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import path from "path";

import { emitMetric } from "./_metrics";

describe("Process-level memory during raw parse (isolated process)", () => {
  test("reports idle, delta, and max RSS from a fresh Bun process", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "run-raw-parse.ts");
    // Run a new Bun process to avoid test-runner overhead
    const output = execFileSync(process.execPath, [ scriptPath ], { encoding: "utf8" });
    const line = output.trim().split(/\n/).pop() || "{}";
    const data = JSON.parse(line) as {
      suite: string;
      parseMs: number;
      txCount: number;
      rssBeforeMb: number;
      rssAfterMb: number;
      rssDeltaMb: number;
    };

    expect(data.txCount).toBeGreaterThan(0);
    expect(typeof data.parseMs).toBe("number");

    // Emit in 'general' suite using agreed metric names
    emitMetric({ suite: "general", name: "mem_proc_idle", value: data.rssBeforeMb, unit: "MB" });
    emitMetric({ suite: "general", name: "mem_proc_parsing_delta", value: data.rssDeltaMb, unit: "MB" });
    // In this isolated process, after is a good proxy for peak for our flow
    emitMetric({ suite: "general", name: "mem_proc_max", value: Math.max(data.rssBeforeMb, data.rssAfterMb), unit: "MB" });
  });
});


