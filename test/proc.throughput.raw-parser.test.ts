import { describe, expect, test } from "bun:test";

import { measureThroughput } from "./runners/run-throughput";
import { emitMetric } from "./_metrics";

describe( "Process-level throughput for raw parse (isolated process)", () => {
  test( "measures avg/median/p95 parse time and derived TPS", () => {
    const data = measureThroughput( 100 ) as {
      suite: string;
      iterations: number;
      txPerBlock: number;
      msAvg: number;
      msMedian: number;
      msP95: number;
      tpsAvg: number;
      tpsMedian: number;
      tpsP95: number;
    };

    expect( data.iterations ).toBeGreaterThan( 0 );
    expect( data.txPerBlock ).toBeGreaterThan( 0 );

    emitMetric( {
      suite: "proc-throughput",
      name: "iterations",
      value: data.iterations,
      unit: "runs"
    } );
    emitMetric( {
      suite: "proc-throughput",
      name: "tx_per_block",
      value: data.txPerBlock,
      unit: "tx"
    } );
    emitMetric( { suite: "proc-throughput", name: "parse_ms_avg", value: data.msAvg, unit: "ms" } );
    emitMetric( {
      suite: "proc-throughput",
      name: "parse_ms_median",
      value: data.msMedian,
      unit: "ms"
    } );
    emitMetric( { suite: "proc-throughput", name: "parse_ms_p95", value: data.msP95, unit: "ms" } );
    emitMetric( { suite: "proc-throughput", name: "tps_avg", value: data.tpsAvg, unit: "tps" } );
    emitMetric( {
      suite: "proc-throughput",
      name: "tps_median",
      value: data.tpsMedian,
      unit: "tps"
    } );
    emitMetric( { suite: "proc-throughput", name: "tps_p95", value: data.tpsP95, unit: "tps" } );
  } );
} );


