import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { Raw } from "src/infrastructure/bitcoin";

import { emitMetric, memoryUsageMb } from "./_metrics";

function getRunningService(): { svc: any; rpc: any } {
  const g = globalThis as any;
  if ( !g.__RUNNING_SERVICE__ ) throw new Error( "service not initialized" );
  return g.__RUNNING_SERVICE__ as { svc: any; rpc: any };
}

describe( "Process-level memory during raw parse (isolated process)", () => {
  test( "reports idle, delta, and max RSS from a fresh parse run", () => {
    const { svc, rpc } = getRunningService();
    // Arrange
    const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
    const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.raw" ) );
    expect( entries.length ).toBeGreaterThan( 0 );
    entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
    const hex = fs.readFileSync( path.join( fixturesDir, entries[0] ), "utf8" ).trim();

    // Ensure service is running and polling; measure idle memory
    const rssIdleMb = memoryUsageMb();
    emitMetric( {
        suite: "general",
        name: "mem_proc_idle",
        value: rssIdleMb,
        unit: "MB",
        details: { block: "fixture" }
      }
    );
    // Measure memory before/after one parse
    const rssBeforeMb = rssIdleMb;
    const t0 = performance.now();
    const block = Raw.parseRawBlock( hex, "mainnet" );
    const t1 = performance.now();
    const rssAfterMb = Math.round( (process.memoryUsage().rss / (1024 * 1024)) * 100 ) / 100;
    const rssDeltaMb = Math.round( (rssAfterMb - rssBeforeMb) * 100 ) / 100;

    expect( block.transactions.length ).toBeGreaterThan( 0 );

    // Emit in 'general' suite using agreed metric names
    emitMetric( {
      suite: "general",
      name: "mem_proc_parsing_delta",
      value: rssDeltaMb,
      unit: "MB",
      details: { block: "fixture" }
    } );
    emitMetric( {
      suite: "general",
      name: "mem_proc_max",
      value: rssAfterMb,
      unit: "MB",
      details: { block: "fixture" }
    } );
  } );
} );


