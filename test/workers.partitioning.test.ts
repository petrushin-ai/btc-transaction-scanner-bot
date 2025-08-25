import { describe, expect, it } from "bun:test";

import { WorkersService } from "@/app/services/WorkersService";

describe( "WorkersService partitioning", () => {
  it( "assigns same address to same worker deterministically", () => {
    const members = [ "w1", "w2", "w3" ];
    const w = new WorkersService( "w1", members );
    const addr = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    const m1 = w.assign( addr );
    const m2 = w.assign( addr );
    expect( m1 ).toBe( m2 );
  } );

  it( "filters watched addresses to responsibility set", () => {
    const members = [ "w1", "w2" ];
    const w1 = new WorkersService( "w1", members );
    const w2 = new WorkersService( "w2", members );
    const watch = [
      { address: "a1" },
      { address: "a2" },
      { address: "a3" },
      { address: "a4" },
    ];
    const f1 = w1.filterWatched( watch ).map( (x) => x.address );
    const f2 = w2.filterWatched( watch ).map( (x) => x.address );
    // disjoint and cover all
    const union = new Set( [ ...f1, ...f2 ] );
    for ( const a of watch.map( (w) => w.address ) ) expect( union.has( a ) ).toBe( true );
    for ( const a of f1 ) expect( f2.includes( a ) ).toBe( false );
  } );
} );


