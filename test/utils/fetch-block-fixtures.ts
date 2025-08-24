import fs from "fs";
import path from "path";

import { loadConfig } from "@/config";
import { BitcoinRpcClient } from "@/infrastructure/bitcoin";

import { updateAddressesFromLatestFixture } from "./update-addresses-from-fixtures";

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, data);
  await fs.promises.rename(tmpPath, filePath);
}

async function main() {
  const cfg = loadConfig();
  const rpc = new BitcoinRpcClient({ url: cfg.bitcoinRpcUrl });

  const fixturesDir = path.join(process.cwd(), "test", "fixtures");
  await ensureDir(fixturesDir);

  const currentHeight = await rpc.getBlockCount();
  const prevHeight = currentHeight - 1;

  const [ currentHash, prevHash ] = await Promise.all([
    rpc.getBlockHash(currentHeight),
    rpc.getBlockHash(prevHeight),
  ]);

  const [ currentVerbose, prevVerbose ] = await Promise.all([
    rpc.getBlockByHashVerbose2(currentHash),
    rpc.getBlockByHashVerbose2(prevHash),
  ]);

  const [ currentRaw, prevRaw ] = await Promise.all([
    rpc.getBlockRawByHash(currentHash),
    rpc.getBlockRawByHash(prevHash),
  ]);

  const prefix = `block-${currentHeight}`;
  const files = [
    { name: `${prefix}-current.json`, data: JSON.stringify(currentVerbose, null, 2) },
    { name: `${prefix}-prev.json`, data: JSON.stringify(prevVerbose, null, 2) },
    { name: `${prefix}-current.raw`, data: `${currentRaw}\n` },
    { name: `${prefix}-prev.raw`, data: `${prevRaw}\n` },
  ];

  for (const f of files) {
    const outPath = path.join(fixturesDir, f.name);
    await writeFileAtomic(outPath, f.data);
    console.log(`wrote ${outPath}`);
  }

  // After fetching fixtures for current and previous blocks, update watched addresses
  await updateAddressesFromLatestFixture({ maxPerCategory: 500 });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed to fetch block fixtures:", message);
  process.exit(1);
});



