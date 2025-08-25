import fs from "fs";
import path from "path";

export type WriteOptions = { encoding?: BufferEncoding; flag?: string } | BufferEncoding;

export interface FileStorageService {
  fileExists(filePath: string): boolean;

  ensureDir(dirPath: string): void;

  ensureFile(filePath: string, initialContent?: string): void;

  readFile(filePath: string, encoding?: BufferEncoding): string;

  writeFile(filePath: string, content: string | Buffer, options?: WriteOptions): void;

  open(filePath: string, flags: string): number;

  fstat(fd: number): fs.Stats;

  read(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;

  write(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;

  ftruncate(fd: number, len: number): void;

  close(fd: number): void;
}

/**
 * Walk upwards from startDir searching for a subPath that must be a directory.
 * Returns the absolute path when found, otherwise null.
 */
export function findUpwardsForSubpath(startDir: string, subPath: string): string | null {
  let currentDir = startDir;
  while ( true ) {
    const candidate = path.resolve( currentDir, subPath );
    try {
      const stat = fs.statSync( candidate );
      if ( stat.isDirectory() ) return candidate;
    } catch {}

    const parent = path.dirname( currentDir );
    if ( parent === currentDir ) break;
    currentDir = parent;
  }
  return null;
}

/**
 * Find the repository root by looking for package.json or .git upwards.
 * Falls back to the provided startDir when nothing is found.
 */
export function findRepoRoot(startDir: string): string {
  let currentDir = startDir;
  while ( true ) {
    const hasPkg = fs.existsSync( path.join( currentDir, "package.json" ) );
    const hasGit = fs.existsSync( path.join( currentDir, ".git" ) );
    if ( hasPkg || hasGit ) return currentDir;

    const parent = path.dirname( currentDir );
    if ( parent === currentDir ) return startDir;
    currentDir = parent;
  }
}

/**
 * Back-compat helper name used elsewhere for repo root discovery.
 */
export function findProjectRoot(startDir: string): string {
  return findRepoRoot( startDir );
}

/**
 * Resolve a path relative to the repo root discovered from startDir.
 */
export function resolveUnderRepo(startDir: string, subPath: string): string {
  const root = findRepoRoot( startDir );
  return path.join( root, subPath );
}

class NodeFsFileStorageService implements FileStorageService {
  fileExists(filePath: string): boolean {
    try {
      fs.accessSync( filePath, fs.constants.F_OK );
      return true;
    } catch {
      return false;
    }
  }

  ensureDir(dirPath: string): void {
    try {
      fs.mkdirSync( dirPath, { recursive: true } );
    } catch {
      // noop
    }
  }

  ensureFile(filePath: string, initialContent: string = ""): void {
    this.ensureDir( path.dirname( filePath ) );
    try {
      if ( !this.fileExists( filePath ) ) {
        fs.writeFileSync( filePath, initialContent, { encoding: "utf-8", flag: "wx" } );
      }
    } catch {
      // noop
    }
  }

  readFile(filePath: string, encoding: BufferEncoding = "utf-8"): string {
    return fs.readFileSync( filePath, encoding );
  }

  writeFile(filePath: string, content: string | Buffer, options?: WriteOptions): void {
    fs.writeFileSync( filePath, content as any, options as any );
  }

  open(filePath: string, flags: string): number {
    return fs.openSync( filePath, flags );
  }

  fstat(fd: number): fs.Stats {
    return fs.fstatSync( fd );
  }

  read(fd: number, buffer: Buffer, offset: number, length: number, position: number): number {
    return fs.readSync( fd, buffer, offset, length, position );
  }

  write(fd: number, buffer: Buffer, offset: number, length: number, position: number): number {
    return fs.writeSync( fd, buffer, offset, length, position );
  }

  ftruncate(fd: number, len: number): void {
    fs.ftruncateSync( fd, len );
  }

  close(fd: number): void {
    try {
      fs.closeSync( fd );
    } catch {
      // noop
    }
  }
}

const defaultStorage = new NodeFsFileStorageService();

export function getFileStorage(): FileStorageService {
  return defaultStorage;
}


