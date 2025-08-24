import { describe, expect, test } from "bun:test";

import { measureLatency } from "./runners/run-latency";
import { emitMetric } from "./_metrics";

describe( "Process-level latency for block discovery to processing", () => {
  test( "emits latency metric from in-process runner", async () => {
    const data = await measureLatency() as { suite: string; latencyMs: number };
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


