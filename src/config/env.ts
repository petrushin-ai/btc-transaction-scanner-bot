import dotenv from "dotenv";
import path from "path";

import { getFileStorage } from "@/infrastructure/storage/FileStorageService";

function fileExists(p: string): boolean {
  const storage = getFileStorage();
  return storage.fileExists( p );
}

export function loadEnvFiles(cwd: string = process.cwd()): void {
  const envFromProcess = process.env.NODE_ENV || process.env.APP_ENV || "development";
  const env = envFromProcess.trim();

  // Find the nearest project root (directory containing package.json or any .env*)
  // starting from cwd and walking up
  function findBaseDir(startDir: string): string {
    let current = startDir;
    while ( true ) {
      const hasPkg = fileExists( path.join( current, "package.json" ) );
      const hasAnyEnv = [
        path.join( current, ".env" ),
        path.join( current, ".env.local" ),
        path.join( current, `.env.${ env }` ),
        path.join( current, `.env.${ env }.local` ),
      ].some( fileExists );
      if ( hasPkg || hasAnyEnv ) return current;
      const parent = path.dirname( current );
      if ( parent === current ) return startDir; // reached filesystem root; fallback to start
      current = parent;
    }
  }

  const baseDir = findBaseDir( cwd );
  const candidates = [
    path.join( baseDir, ".env" ),
    path.join( baseDir, ".env.local" ),
    path.join( baseDir, `.env.${ env }` ),
    path.join( baseDir, `.env.${ env }.local` ),
  ];

  for ( const p of candidates ) {
    if ( !fileExists( p ) ) continue;
    // Do not override existing process env variables; external env takes precedence
    dotenv.config( { path: p, override: false } );
  }
}

