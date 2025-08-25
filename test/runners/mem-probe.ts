import fs from "fs";
import path from "path";

import { parseRawBlock } from "@/infrastructure/bitcoin/raw";

import { memoryUsageMb, peakMemoryUsageMb } from "../_metrics";

function loadFixtureHex(): string {
  const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
  const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.raw" ) );
  if ( entries.length === 0 ) throw new Error( "No raw fixtures" );
  entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
  const rawPath = path.join( fixturesDir, entries[0] );
  return fs.readFileSync( rawPath, "utf8" ).trim();
}

async function main(): Promise<void> {
  try {
    if ( typeof (Bun as any).gc === "function" ) (Bun as any).gc( true );
  } catch {
  }
  const rssIdleMb = memoryUsageMb();

  const hex = loadFixtureHex();
  // Perform a single parse
  const t0 = performance.now();
  const block = parseRawBlock( hex, "mainnet" );
  const t1 = performance.now();
  if ( !block || block.transactions.length === 0 ) throw new Error( "Parse failed" );
  try {
    if ( typeof (Bun as any).gc === "function" ) (Bun as any).gc( true );
  } catch {
  }
  const rssAfterMb = memoryUsageMb();
  const deltaMb = Math.round( (rssAfterMb - rssIdleMb) * 100 ) / 100;
  const peakMb = peakMemoryUsageMb();

  const result = {
    mem_idle: rssIdleMb,
    rss_after_mb: rssAfterMb,
    mem_delta: deltaMb,
    max_rss_mb: typeof peakMb === "number" ? peakMb : undefined,
    parse_ms: Math.round( (t1 - t0) * 100 ) / 100,
  };
  // Emit as single JSON line for parent process to parse
  // eslint-disable-next-line no-console
  console.log( JSON.stringify( result ) );
}

void main();


