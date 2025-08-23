import fs from "fs";
import path from "path";
import { Raw } from "@/infrastructure/bitcoin";

function main() {
  const fixturesDir = path.join(process.cwd(), "tests/fixtures");
  const rawHex = fs.readFileSync(path.join(fixturesDir, "block-4646283-current.raw"), "utf8").trim();
  const json = JSON.parse(fs.readFileSync(path.join(fixturesDir, "block-4646283-current.json"), "utf8"));

  const parsed = Raw.parseRawBlock(rawHex, "mainnet");

  const summary = {
    txCountRaw: parsed.transactions.length,
    txCountJson: (json.tx || []).length,
    opReturnRaw: parsed.transactions.reduce((acc, t) => acc + t.outputs.filter((o) => o.opReturnDataHex).length, 0),
    opReturnJson: (json.tx || []).reduce((acc: number, t: any) => {
      return (
        acc +
        (t.vout || []).filter((v: any) => v.scriptPubKey?.type === "nulldata" && typeof v.scriptPubKey?.asm === "string").length
      );
    }, 0),
    addressesRaw: parsed.transactions.reduce((acc, t) => acc + t.outputs.filter((o) => o.address).length, 0),
  };

  console.log(JSON.stringify({ type: "test.compare_raw_verbose", ...summary }));
}

main();


