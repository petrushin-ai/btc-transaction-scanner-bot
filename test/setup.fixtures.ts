import { beforeAll } from "bun:test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

function fixturesPresent(fixturesDir: string): boolean {
  try {
    const entries = fs.readdirSync( fixturesDir );
    return entries.some( (f) => f.endsWith( "-current.raw" ) );
  } catch {
    return false;
  }
}

beforeAll( () => {
  const fixturesDir = path.join( process.cwd(), "test", "fixtures" );
  if ( fixturesPresent( fixturesDir ) ) return;

  // eslint-disable-next-line no-console
  console.log( "[pre-test] Block fixtures missing. Fetching via fixtures:get-blocks..." );
  try {
    execSync( "bun run fixtures:get-blocks", { stdio: "inherit" } );
  } catch ( err ) {
    const msg = err instanceof Error ? err.message : String( err );
    // eslint-disable-next-line no-console
    console.error( "[pre-test] Failed to fetch block fixtures:", msg );
    throw err;
  }

  if ( !fixturesPresent( fixturesDir ) ) {
    throw new Error( "[pre-test] Fixtures still missing after fetch attempt" );
  }
} );


