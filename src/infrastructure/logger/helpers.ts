import path from "path";
import pino from "pino";
import { Writable } from "stream";

import { getFileStorage } from "@/infrastructure/storage/FileStorageService";

export type LoggingEnv = {
  environment: string;
  serviceName: string;
  logLevel: string;
  logPretty: boolean;
};

export function getLoggingEnv(): LoggingEnv {
  const environment = (process.env.APP_ENV || process.env.NODE_ENV || "development").trim();
  const serviceName = process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot";
  const defaultLevel = environment === "development" ? "trace" : "info";
  const logLevel = process.env.LOG_LEVEL || defaultLevel;
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toLowerCase() === "true";
  return { environment, serviceName, logLevel, logPretty };
}

export function fileExists(filePath: string): boolean {
  const storage = getFileStorage();
  return storage.fileExists( filePath );
}

export function findProjectRoot(startDir: string): string {
  let current = startDir;
  while ( true ) {
    if ( fileExists( path.join( current, "package.json" ) ) ) return current;
    const parent = path.dirname( current );
    if ( parent === current ) return startDir;
    current = parent;
  }
}

export function ensureFile(filePath: string, initialContent = ""): void {
  const storage = getFileStorage();
  storage.ensureFile( filePath, initialContent );
}

export function normalizeJsonFileName(rawName: string): string {
  const base = path.basename( rawName.trim() );
  const hasJson = base.toLowerCase().endsWith( ".json" );
  return hasJson ? base : `${ base }.json`;
}

/**
 * Normalize a log filename to the appropriate extension based on mode.
 * - Strips existing .json or .ndjson extensions
 * - Appends .ndjson when ndjson=true, otherwise .json
 */
export function normalizeLogFileName(rawName: string, ndjson: boolean): string {
  const base = path.basename( rawName.trim() );
  const lower = base.toLowerCase();
  let stem = base;
  if ( lower.endsWith( ".json" ) ) {
    stem = base.slice( 0, -5 );
  } else if ( lower.endsWith( ".ndjson" ) ) {
    stem = base.slice( 0, -7 );
  }
  const ext = ndjson ? ".ndjson" : ".json";
  return `${ stem }${ ext }`;
}

export function createFileDestination(filePath: string, isSync: boolean): pino.DestinationStream {
  return pino.destination( { dest: filePath, sync: isSync } );
}

export function buildStdoutStream(logPretty: boolean): pino.DestinationStream {
  if ( logPretty ) {
    return pino.transport( {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        singleLine: false,
        messageKey: "msg",
        ignore: "pid,hostname",
      },
    } );
  }
  return pino.destination( 1 );
}

/**
 * Create a destination stream that maintains a valid JSON array in the target file at all times.
 * Each log record (chunk) is inserted before the trailing closing bracket. The file is initialized
 * as an empty array `[]` and remains a valid JSON array even between writes.
 *
 * Implementation notes:
 * - Uses synchronous file operations for correctness and simplicity since writes are tiny.
 * - On each write, it overwrites the final `]` with `,(optional)\n<chunk>\n]` depending on whether
 *   the array already contains elements.
 */
export function createJsonArrayFileDestination(filePath: string): pino.DestinationStream {
  ensureFile( filePath, "[]\n" );
  const storage = getFileStorage();

  return new Writable( {
    decodeStrings: false,
    write(chunk, _enc, callback) {
      try {
        // Normalize to a JSON object
        let asString: string;
        if ( typeof chunk === "string" ) {
          asString = chunk;
        } else if ( Buffer.isBuffer( chunk ) ) {
          asString = chunk.toString( "utf-8" );
        } else {
          try {
            asString = JSON.stringify( chunk );
          } catch {
            asString = String( chunk );
          }
        }
        asString = asString.trim();
        if ( !asString ) {
          callback();
          return;
        }

        let obj: any;
        try {
          obj = JSON.parse( asString );
        } catch {
          callback( new Error( "Invalid JSON chunk for array destination" ) );
          return;
        }

        // Read-modify-write to keep valid JSON array semantics across runtimes
        let current = "";
        try {
          current = storage.readFile( filePath, "utf-8" );
        } catch {
        }
        let arr: any[] = [];
        try {
          const parsed = JSON.parse( (current || "[]").toString() );
          if ( Array.isArray( parsed ) ) arr = parsed; else arr = [];
        } catch {
          arr = [];
        }
        arr.push( obj );
        const next = `${ JSON.stringify( arr ) }\n`;
        storage.writeFile( filePath, next, { encoding: "utf-8" } );
        callback();
      } catch ( err ) {
        callback( err as Error );
      }
    }
  } ) as unknown as pino.DestinationStream;
}


/**
 * Creates a callable object from a default instance and an invocation function.
 * The returned function is callable (delegates to invoke) and exposes the same
 * methods/properties as the default instance, correctly bound.
 */
export function makeCallable<T extends object>(
  invoke: (...args: unknown[]) => T,
  defaultInstance: T,
): ((...args: unknown[]) => T) & T {
  const callable = ((...args: unknown[]) => invoke( ...args )) as ((...args: unknown[]) => T) & T;

  const ownNames = Object.getOwnPropertyNames( defaultInstance );
  const proto = Object.getPrototypeOf( defaultInstance ) as object | null;
  const protoNames = proto ? Object.getOwnPropertyNames( proto ) : [];
  const symbolKeys = (Object.getOwnPropertySymbols( defaultInstance ) as (string | symbol)[]) || [];
  const propertyKeys = [
    ...new Set<string | symbol>( [ ...ownNames, ...protoNames, ...symbolKeys ] ),
  ];

  for ( const key of propertyKeys ) {
    if (
      key === "prototype" ||
      key === "name" ||
      key === "length" ||
      key === "arguments" ||
      key === "caller"
    ) {
      continue;
    }

    const descriptor =
      Object.getOwnPropertyDescriptor( defaultInstance as any, key as PropertyKey ) ||
      (proto ? Object.getOwnPropertyDescriptor( proto as any, key as PropertyKey ) : undefined);
    if ( !descriptor ) continue;

    if ( typeof (descriptor as any).value === "function" ) {
      Object.defineProperty( callable, key, {
        value: ((descriptor as any).value as Function).bind( defaultInstance ),
        writable: true,
        enumerable: (descriptor as PropertyDescriptor).enumerable ?? true,
        configurable: true,
      } );
    } else if ( (descriptor as PropertyDescriptor).get || (descriptor as PropertyDescriptor).set ) {
      Object.defineProperty( callable, key, {
        get: (descriptor as PropertyDescriptor).get
          ? (descriptor as PropertyDescriptor).get!.bind( defaultInstance )
          : undefined,
        set: (descriptor as PropertyDescriptor).set
          ? (descriptor as PropertyDescriptor).set!.bind( defaultInstance )
          : undefined,
        enumerable: (descriptor as PropertyDescriptor).enumerable ?? true,
        configurable: true,
      } );
    } else {
      Object.defineProperty( callable, key, {
        get: () => (defaultInstance as any)[key as any],
        set: (val) => {
          (defaultInstance as any)[key as any] = val;
        },
        enumerable: (descriptor as PropertyDescriptor).enumerable ?? true,
        configurable: true,
      } );
    }
  }

  return callable;
}
