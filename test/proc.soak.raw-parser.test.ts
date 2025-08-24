import { describe, expect, test } from "bun:test";

import { runSoak } from "./runners/run-soak";
import { emitMetric } from "./_metrics";

describe( "Process-level soak (10 TPS, 1k addresses)", () => {
  test( "runs for configured duration and asserts memory ceiling and steady latency", async () => {
    const data = await runSoak( 10 ) as {
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
    // Leave memory metrics to dedicated tests/setup; avoid duplicates here
  } );
} );
