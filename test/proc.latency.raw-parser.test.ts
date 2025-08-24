import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import path from "path";

import { emitMetric } from "./_metrics";

describe( "Process-level latency for block discovery to processing", () => {
  test( "emits latency metric from a fresh Bun process", () => {
    const scriptPath = path.join( process.cwd(), "scripts", "run-latency.ts" );
    const output = execFileSync( process.execPath, [ scriptPath ], { encoding: "utf8" } );
    const lines = output.split( /\n/ ).map( (l) => l.trim() ).filter( Boolean );
    const jsonLine = [ ...lines ]
      .reverse()
      .find( (l) => l.startsWith( "{" ) && l.endsWith( "}" ) ) || "{}";
    const data = JSON.parse( jsonLine ) as { suite: string; latencyMs: number };
    expect( typeof data.latencyMs ).toBe( "number" );
    emitMetric( {
      suite: "latency",
      name: "block_discovery_to_processing_ms",
      value: data.latencyMs,
      unit: "ms"
    } );
    expect( data.latencyMs ).toBeLessThanOrEqual( 5000 );
  } );
} );


