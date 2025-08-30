import fs from "fs";
import path from "path";

import { normalizeWatchedAddresses } from "@/app/helpers/bitcoin";
import { Raw } from "@/infrastructure/bitcoin";
import type { ParsedRawBlock } from "@/infrastructure/bitcoin/raw/BlockParser";
import { findLatestCurrentBlockBase, resolveFixturesDir } from "@/shared/helpers";

function main() {
  const fixturesDir = resolveFixturesDir( import.meta.url );
  const base = findLatestCurrentBlockBase( fixturesDir );
  const rawHex = fs.readFileSync( path.join( fixturesDir, `${ base }.raw` ), "utf8" ).trim();
  const json = JSON.parse( fs.readFileSync( path.join( fixturesDir, `${ base }.json` ), "utf8" ) );
  const watchedFile = path.join( process.cwd(), "addresses.json" );
  const watched = JSON.parse( fs.readFileSync( watchedFile, "utf8" ) );
  const norm = normalizeWatchedAddresses( (watched || []).map( (x: any) => ({
    address: x.address,
    label: x.label
  }) ), "mainnet" as any );

  const parsed: ParsedRawBlock = Raw.parseRawBlock( rawHex, "mainnet" );
  const hits: { address: string; txid: string; valueBtc: number }[] = [];
  const watchSet = new Set( norm.map( (x) => x.address ) );
  for ( const tx of parsed.transactions ) {
    for ( const out of tx.outputs ) {
      if ( out.address && watchSet.has( out.address ) && out.valueBtc > 0 ) {
        hits.push( { address: out.address, txid: tx.txid, valueBtc: out.valueBtc } );
      }
    }
  }
  console.log( JSON.stringify( {
    type: "test.validate_watched",
    base,
    watched: norm,
    totalTx: parsed.transactions.length,
    hits
  } ) );
}

main();


