import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";

import { Raw } from "@/infrastructure/bitcoin";

function readHex(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").trim();
}

describe("Raw block parsing consistency", () => {
  test("tx count matches verbose JSON fixture and decodes addresses/OP_RETURN", () => {
    const fixturesDir = path.join(process.cwd(), "test", "fixtures");
    const entries = fs.readdirSync(fixturesDir).filter((f) => f.endsWith("-current" + ".raw"));
    if (entries.length === 0) throw new Error("No *.raw fixtures found");
    // choose latest by height in filename
    entries.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    const rawPath = path.join(fixturesDir, entries[0]);
    const jsonPath = rawPath.replace(/\.raw$/, ".json");
    const hex = readHex(rawPath);
    const verbose = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    const parsed = Raw.parseRawBlock(hex, "mainnet");

    expect(parsed.transactions.length).toBe((verbose.tx || []).length);

    const addressCount = parsed.transactions.reduce((acc, t) => acc + t.outputs.filter((o) => Boolean(o.address)).length, 0);
    expect(addressCount).toBeGreaterThan(0);

    const opRetCount = parsed.transactions.reduce((acc, t) => acc + t.outputs.filter((o) => o.scriptType === "nulldata").length, 0);
    // zero is possible but unlikely; still assert that opReturn entries, if any, carry data hex
    if (opRetCount > 0) {
      const withData = parsed.transactions.flatMap((t) => t.outputs).filter((o) => o.scriptType === "nulldata" && Boolean(o.opReturnDataHex));
      expect(withData.length).toBe(opRetCount);
    }
  });
});


