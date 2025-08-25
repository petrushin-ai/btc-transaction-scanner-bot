import { expect, test } from "bun:test";

import { emitMetric } from "./_metrics";

function runProbe(): any {
  const proc = Bun.spawnSync( {
    cmd: [ "bun", "run", "test/runners/mem-probe.ts" ],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LOG_STDOUT: "false", LOG_PRETTY: "false" }
  } );
  const out = new TextDecoder().decode( proc.stdout ).trim();
  const err = new TextDecoder().decode( proc.stderr ).trim();
  if ( proc.exitCode !== 0 ) {
    throw new Error( `mem-probe failed (${ proc.exitCode }): ${ err || out }` );
  }
  try {
    return JSON.parse( out.split( /\n+/ ).filter( Boolean ).pop()! );
  } catch ( e ) {
    throw new Error( `Failed to parse mem-probe output: ${ out }` );
  }
}

test( "Isolated mem probe (child process) reports RSS and delta", () => {
  const r = runProbe();
  expect( typeof r.mem_idle ).toBe( "number" );
  expect( typeof r.mem_delta ).toBe( "number" );

  emitMetric( { suite: "mem-probe", name: "mem_idle", value: r.mem_idle, unit: "MB" } );
  if ( typeof r.max_rss_mb === "number" ) emitMetric( {
    suite: "mem-probe",
    name: "mem_max",
    value: r.max_rss_mb,
    unit: "MB"
  } );
  emitMetric( { suite: "mem-probe", name: "mem_delta", value: r.mem_delta, unit: "MB" } );

  expect( r.mem_idle ).toBeLessThanOrEqual( 512 );
} );


