import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import path from "path";

import { emitMetric } from "./_metrics";

describe( "Process-level soak (10 TPS, 1k addresses)", () => {
  test( "runs for configured duration and asserts memory ceiling and steady latency", () => {
    const scriptPath = path.join( process.cwd(), "scripts", "run-soak.ts" );
    const output = execFileSync( process.execPath, [ scriptPath ], {
      encoding: "utf8",
      env: { ...process.env, SOAK_SECONDS: "10" },
    } );
    const lines = output.split( /\n/ ).map( (l) => l.trim() ).filter( Boolean );
    const jsonLine = [ ...lines ]
      .reverse()
      .find( (l) => l.startsWith( "{" ) && l.endsWith( "}" ) ) || "{}";
    const data = JSON.parse( jsonLine ) as {
      suite: string;
      seconds: number;
      tpsTarget: number;
      tpsMeasured: number;
      rssIdleMb: number;
      rssMaxMb: number;
      rssDeltaMb: number;
      p95BlockLatencyMs: number;
    };

    // Basic expectations
    expect( data.seconds ).toBeGreaterThanOrEqual( 10 );
    expect( data.tpsMeasured ).toBeGreaterThanOrEqual( 7 ); // steady >= 7 TPS
    expect( data.rssDeltaMb ).toBeLessThan( 64 ); // memory ceiling
    expect( data.p95BlockLatencyMs ).toBeLessThan( 500 ); // steady per-block processing latency

    // Emit metrics
    emitMetric( {
      suite: "proc-soak",
      name: "tps_measured",
      value: data.tpsMeasured,
      unit: "tps"
    } );
    emitMetric( { suite: "proc-soak", name: "rss_idle_mb", value: data.rssIdleMb, unit: "MB" } );
    emitMetric( { suite: "proc-soak", name: "rss_max_mb", value: data.rssMaxMb, unit: "MB" } );
    emitMetric( { suite: "proc-soak", name: "rss_delta_mb", value: data.rssDeltaMb, unit: "MB" } );
    emitMetric( {
      suite: "proc-soak",
      name: "p95_block_latency_ms",
      value: data.p95BlockLatencyMs,
      unit: "ms"
    } );
  } );
} );
