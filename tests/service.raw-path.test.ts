import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";

import { BitcoinService } from "@/application/services/BitcoinService";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type { ParsedBlock } from "@/types/blockchain";

class MockRpc extends BitcoinRpcClient {
  private hex: string;
  private header: { height: number; time: number };
  constructor(hex: string, header: { height: number; time: number }) {
    super({ url: "http://localhost:0" });
    this.hex = hex;
    this.header = header;
  }
  async getBlockchainInfo(): Promise<any> { return { chain: "main" }; }
  async getBlockRawByHash(_hash: string): Promise<string> { return this.hex; }
  async getBlockHeader(_hash: string): Promise<any> { return this.header; }
}

function loadFixture(): { hex: string; header: { height: number; time: number }; json: any } {
  const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
  const entries = fs.readdirSync(fixturesDir).filter((f) => f.endsWith("-current" + ".raw"));
  if (entries.length === 0) throw new Error("No raw fixtures");
  entries.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const rawPath = path.join(fixturesDir, entries[0]);
  const jsonPath = rawPath.replace(/\.raw$/, ".json");
  const hex = fs.readFileSync(rawPath, "utf8").trim();
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  return { hex, header: { height: json.height, time: json.time }, json };
}

describe("Service raw parsing path", () => {
  test("parseBlockByHash with parseRawBlocks=true returns expected tx count and metadata", async () => {
    const { hex, header, json } = loadFixture();
    const rpc = new MockRpc(hex, header);
    const svc = new BitcoinService(rpc, { parseRawBlocks: true });
    await svc.connect();
    const block: ParsedBlock = await svc.parseBlockByHash("ignored");
    expect(block.height).toBe(header.height);
    expect(block.time).toBe(header.time);
    expect(block.transactions.length).toBe((json.tx || []).length);
    // basic sanity on outputs metadata
    const anyAddress = block.transactions.some((t) => t.outputs.some((o) => Boolean(o.address)));
    expect(anyAddress).toBe(true);
    const anyOpRet = block.transactions.some((t) => t.outputs.some((o) => o.scriptType === "nulldata" ? Boolean(o.opReturnDataHex) : true));
    expect(anyOpRet).toBe(true);
  });
});


