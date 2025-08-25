import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findRepoRoot, findUpwardsForSubpath } from "@/infrastructure/storage/FileStorageService";

export function resolveFixturesDir(fromUrl: string): string {
  const scriptDir = path.dirname( fileURLToPath( fromUrl ) );
  const fromScript = findUpwardsForSubpath( scriptDir, "test/fixtures" );
  if ( fromScript ) return fromScript;

  const fromCwd = findUpwardsForSubpath( process.cwd(), "test/fixtures" );
  if ( fromCwd ) return fromCwd;

  throw new Error( `Fixtures directory not found. Looked upwards from '${ scriptDir }' and '${ process.cwd() }' for 'test/fixtures'.` );
}

export function findLatestCurrentBlockBase(fixturesDir: string): string {
  const entries = fs.readdirSync( fixturesDir );
  const candidates = entries.filter( (name) => name.endsWith( "-current.raw" ) );
  if ( candidates.length === 0 ) {
    throw new Error( `No '*-current.raw' fixture found in ${ fixturesDir }` );
  }

  candidates.sort( (a, b) => {
    const na = parseInt( a.match( /block-(\d+)-current\.raw/ )?.[1] ?? "0", 10 );
    const nb = parseInt( b.match( /block-(\d+)-current\.raw/ )?.[1] ?? "0", 10 );
    return nb - na;
  } );

  return candidates[0].replace( /.raw$/, "" );
}

// For writers: pick the canonical repo fixtures directory without requiring it to exist
export function preferFixturesDir(fromUrl: string): string {
  const scriptDir = path.dirname( fileURLToPath( fromUrl ) );
  const repoRoot = findRepoRoot( scriptDir );
  return path.join( repoRoot, "test/fixtures" );
}


