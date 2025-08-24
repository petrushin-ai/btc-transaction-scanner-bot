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


