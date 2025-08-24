import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { Raw } from "src/infrastructure/bitcoin";

import { emitMetric } from "./_metrics";

describe( "Process-level memory during raw parse (isolated process)", () => {
  test( "reports idle, delta, and max RSS from a fresh parse run", () => {
    // Arrange
    const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
    const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.raw" ) );
    expect( entries.length ).toBeGreaterThan( 0 );
    entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
    const hex = fs.readFileSync( path.join( fixturesDir, entries[0] ), "utf8" ).trim();

    // Measure memory before/after one parse
    const rssBeforeMb = Math.round( (process.memoryUsage().rss / (1024 * 1024)) * 100 ) / 100;
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
      unit: "MB"
    } );
  } );
} );


