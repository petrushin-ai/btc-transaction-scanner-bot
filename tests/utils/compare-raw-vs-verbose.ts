import fs from "fs";
import path from "path";

import { Raw } from "@/infrastructure/bitcoin";
import type { ParsedRawBlock } from "@/infrastructure/bitcoin/raw/BlockParser";
import type { ParsedTx } from "@/infrastructure/bitcoin/raw/TxParser";

function main() {
  const fixturesDir = path.join(process.cwd(), "tests/fixtures");
  const rawHex = fs.readFileSync(path.join(fixturesDir, "block-4646283-current.raw"), "utf8").trim();
  const json = JSON.parse(fs.readFileSync(path.join(fixturesDir, "block-4646283-current.json"), "utf8"));

  const parsed: ParsedRawBlock = Raw.parseRawBlock(rawHex, "mainnet");

  const summary = {
    txCountRaw: parsed.transactions.length,
    txCountJson: (json.tx || []).length,
    opReturnRaw: parsed.transactions.reduce(
      (acc: number, t: ParsedTx) => acc + t.outputs.filter((o) => Boolean(o.opReturnDataHex)).length,
      0
    ),
    opReturnJson: (json.tx || []).reduce((acc: number, t: any) => {
      return (
        acc +
        (t.vout || []).filter((v: any) => v.scriptPubKey?.type === "nulldata" && typeof v.scriptPubKey?.asm === "string").length
      );
    }, 0),
    addressesRaw: parsed.transactions.reduce(
      (acc: number, t: ParsedTx) => acc + t.outputs.filter((o) => Boolean(o.address)).length,
      0
    ),
  };

  console.log(JSON.stringify({ type: "test.compare_raw_verbose", ...summary }));
}

main();



