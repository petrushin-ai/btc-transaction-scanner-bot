import fs from "fs";
import path from "path";
import { Raw } from "src/infrastructure/bitcoin";

function readHex(filePath: string): string {
  return fs.readFileSync( filePath, "utf8" ).trim();
}

function mean(nums: number[]): number {
  const s = nums.reduce( (a, b) => a + b, 0 );
  return s / (nums.length || 1);
}

function median(nums: number[]): number {
  if ( nums.length === 0 ) return 0;
  const a = nums.slice().sort( (x, y) => x - y );
  const mid = Math.floor( a.length / 2 );
  // even length: average the two middle values
  if ( a.length % 2 === 0 ) return (a[mid - 1] + a[mid]) / 2;
  // odd length: middle element
  return a[mid];
}

async function main() {
  const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
  const entries = fs.readdirSync( fixturesDir ).filter( (f) => f.endsWith( "-current.raw" ) );
  if ( entries.length === 0 ) {
    console.error( "No *.raw fixtures found" );
    process.exit( 2 );
  }
  entries.sort( (a, b) => Number( b.split( "-" )[1] ) - Number( a.split( "-" )[1] ) );
  const rawPath = path.join( fixturesDir, entries[0] );
  const hex = readHex( rawPath );

  // Warm up parse once
  Raw.parseRawBlock( hex, "mainnet" );

  const iterations = Number( process.env.THROUGHPUT_RUNS || 50 );
  const times: number[] = [];
  let totalTx = 0;
  for ( let i = 0; i < iterations; i++ ) {
    const t0 = performance.now();
    const block = Raw.parseRawBlock( hex, "mainnet" );
    const t1 = performance.now();
    times.push( t1 - t0 );
    totalTx = block.transactions.length; // same block each time
  }

  const msAvg = mean( times );
  const msMedian = median( times );
  const msP95 = times.slice().sort( (a, b) => a - b )[Math.floor( 0.95 * (times.length - 1) )];

  // TPS approximations for the given fixture
  const tpsAvg = (totalTx / (msAvg / 1000));
  const tpsMedian = (totalTx / (msMedian / 1000));
  const tpsP95 = (totalTx / (msP95 / 1000));

  const out = {
    suite: "proc-throughput",
    iterations,
    txPerBlock: totalTx,
    msAvg: Math.round( msAvg ),
    msMedian: Math.round( msMedian ),
    msP95: Math.round( msP95 ),
    tpsAvg: Math.round( tpsAvg ),
    tpsMedian: Math.round( tpsMedian ),
    tpsP95: Math.round( tpsP95 ),
  };
  console.log( JSON.stringify( out ) );
}

main().catch( (err) => {
  console.error( String( err?.message || err ) );
  process.exit( 1 );
} );


