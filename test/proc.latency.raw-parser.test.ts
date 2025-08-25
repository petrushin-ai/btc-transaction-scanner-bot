import { describe, expect, test } from "bun:test";
import { TextDecoder } from "util";

import { emitMetric } from "./_metrics";

describe( "Latency: block discovery to stdout notification", () => {
  test( "spawns prod-like runner and measures to stdout", async () => {
    const proc = Bun.spawnSync( {
      cmd: [ "bun", "run", "test/runners/latency-stdout.ts" ],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, APP_ENV: "production", LOG_STDOUT: "true", LOG_PRETTY: "false" }
    } );
    const out = new TextDecoder().decode( proc.stdout ).trim();
    const err = new TextDecoder().decode( proc.stderr ).trim();
    if ( proc.exitCode !== 0 ) {
      throw new Error( `latency runner failed (${ proc.exitCode }): ${ err || out }` );
    }
    const lines = out.split( /\n+/ ).filter( Boolean );
    let data: { suite: string; latencyMs: number } | null = null;
    for ( const line of lines ) {
      try {
        const obj = JSON.parse( line );
        if ( obj && typeof obj.latencyMs === "number" ) {
          data = obj;
          break;
        }
      } catch {
      }
    }
    if ( !data ) throw new Error( `No latency data in output: ${ out }` );
    expect( typeof data.latencyMs ).toBe( "number" );
    emitMetric( {
      suite: "latency",
      name: "block_discovery_to_stdout",
      value: data.latencyMs,
      unit: "ms"
    } );
    expect( data.latencyMs ).toBeLessThanOrEqual( 5000 );
  } );
} );


