import fs from "fs";
import path from "path";
import { parseRawBlock } from "../src/infrastructure/bitcoin/raw/BlockParser";
import type { Network } from "../src/infrastructure/bitcoin/raw/Address";

type AddressEntry = { address: string; label?: string };

function listFixturePairs(fixturesDir: string): { base: string; currentRaw: string; prevRaw: string }[] {
  const entries = fs.readdirSync(fixturesDir);
  const bases = new Map<string, { current?: string; prev?: string }>();
  for (const name of entries) {
    if (!name.endsWith(".raw")) continue;
    const m = name.match(/^block-(\d+)-(current|prev)\.raw$/);
    if (!m) continue;
    const base = `block-${m[1]}`;
    const kind = m[2];
    const existing = bases.get(base) || {};
    if (kind === "current") existing.current = name;
    else existing.prev = name;
    bases.set(base, existing);
  }
  const pairs: { base: string; currentRaw: string; prevRaw: string }[] = [];
  for (const [base, v] of bases) {
    if (v.current && v.prev) pairs.push({ base, currentRaw: v.current, prevRaw: v.prev });
  }
  // sort by numeric height in base name
  pairs.sort((a, b) => {
    const ha = Number(a.base.split("-")[1]);
    const hb = Number(b.base.split("-")[1]);
    return hb - ha;
  });
  return pairs;
}

function readRawHex(filePath: string): string {
  const hex = fs.readFileSync(filePath, "utf8").trim();
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`Invalid hex in ${filePath}`);
  return hex;
}

function extractAddressesFromBlockHex(hex: string, network: Network): { txCount: number; outputs: { address?: string }[] } {
  const block = parseRawBlock(hex, network);
  const outputs = block.transactions.flatMap((tx) => tx.outputs.map((o) => ({ address: o.address })));
  return { txCount: block.transactions.length, outputs };
}

function upsertAddresses(target: AddressEntry[], candidates: string[], limit: number): AddressEntry[] {
  const existing = new Map(target.map((e) => [e.address, e] as const));
  let added = 0;
  for (const addr of candidates) {
    if (!addr) continue;
    if (added >= limit) break;
    if (!existing.has(addr)) {
      target.push({ address: addr });
      existing.set(addr, { address: addr });
      added++;
    }
  }
  return target;
}

async function main() {
  const cwd = process.cwd();
  const fixturesDir = path.join(cwd, "tests", "fixtures");
  const pairs = listFixturePairs(fixturesDir);
  if (pairs.length === 0) {
    console.error("No fixture pairs found in tests/fixtures");
    process.exit(1);
  }

  const latest = pairs[0];
  const network: Network = "mainnet"; // adjust if needed in future based on env

  const currentHex = readRawHex(path.join(fixturesDir, latest.currentRaw));
  const prevHex = readRawHex(path.join(fixturesDir, latest.prevRaw));

  const current = extractAddressesFromBlockHex(currentHex, network);
  const prev = extractAddressesFromBlockHex(prevHex, network);

  // Summaries
  console.log(JSON.stringify({ block: latest.base, current: { txCount: current.txCount }, prev: { txCount: prev.txCount } }));

  const currentSet = new Set(current.outputs.map((o) => o.address).filter(Boolean) as string[]);
  const prevSet = new Set(prev.outputs.map((o) => o.address).filter(Boolean) as string[]);

  const intersection: string[] = [];
  const onlyPrev: string[] = [];
  const onlyCurrent: string[] = [];

  for (const a of prevSet) {
    if (currentSet.has(a)) intersection.push(a);
    else onlyPrev.push(a);
  }
  for (const a of currentSet) {
    if (!prevSet.has(a)) onlyCurrent.push(a);
  }

  // Load existing addresses.json
  const addressesPath = path.join(cwd, "addresses.json");
  let existing: AddressEntry[] = [];
  try {
    const raw = fs.readFileSync(addressesPath, "utf8");
    const json = JSON.parse(raw);
    if (Array.isArray(json)) existing = json.filter((x) => typeof x?.address === "string");
  } catch {
    existing = [];
  }

  // Upsert up to 500 from each category
  let updated = existing.slice();
  updated = upsertAddresses(updated, intersection, 500);
  updated = upsertAddresses(updated, onlyPrev, 500);
  updated = upsertAddresses(updated, onlyCurrent, 500);

  // Write back atomically
  const tmp = `${addressesPath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(updated, null, 2) + "\n");
  await fs.promises.rename(tmp, addressesPath);

  console.log(
    JSON.stringify({
      added: {
        in_both: Math.min(500, intersection.length),
        only_prev: Math.min(500, onlyPrev.length),
        only_current: Math.min(500, onlyCurrent.length),
      },
      totals: {
        existing: existing.length,
        after: updated.length,
      },
    })
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("update-addresses-from-fixtures failed:", message);
  process.exit(1);
});


