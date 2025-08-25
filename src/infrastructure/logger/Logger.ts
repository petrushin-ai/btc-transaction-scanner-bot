import os from "os";
import path from "path";
import pino, { Logger as PinoLogger } from "pino";

import { loadEnvFiles } from "@/config/env";
import { findProjectRoot } from "@/infrastructure/storage/FileStorageService";

import {
  buildStdoutStream,
  createFileDestination,
  createJsonArrayFileDestination,
  ensureFile,
  getLoggingEnv,
  makeCallable,
  normalizeLogFileName,
} from "./helpers";

export type AppLogger = PinoLogger;

export type LoggerOptions = {
  fileName?: string;
  /** When true, write NDJSON lines to files; otherwise maintain a JSON array */
  ndjson?: boolean;
};

const cachedByFileName: Map<string, AppLogger> = new Map();

function getLogger(arg?: string | LoggerOptions): AppLogger {
  const options: LoggerOptions = typeof arg === "string" ? { fileName: arg } : (arg || {});
  const fileName = options.fileName?.trim();
  const useNdjson = options.ndjson ?? true;

  const cacheKey = `${ fileName || "__default__" }::ndjson=${ useNdjson ? "1" : "0" }`;
  const existing = cachedByFileName.get( cacheKey );
  if ( existing ) return existing;
  // Load .env files without performing any validation. This avoids coupling the
  // logger to the validated app config and allows graceful defaults.
  loadEnvFiles();

  const { environment, serviceName, logLevel, logPretty } = getLoggingEnv();

  // Resolve the project root (the nearest directory containing package.json)
  const projectRoot = findProjectRoot( process.cwd() );

  // Ensure directory and file exist for consistent behavior across environments

  // Build multi-destination streams: always output to logs/output[.json|.ndjson] and stdout
  const defaultLogFile = useNdjson ? "output.ndjson" : "output.json";
  const logFilePath = path.join( projectRoot, "logs", defaultLogFile );
  ensureFile( logFilePath, "" );
  const fileStream = useNdjson
    ? createFileDestination( logFilePath, environment === "development" )
    : createJsonArrayFileDestination( logFilePath );
  const stdoutStream = buildStdoutStream( logPretty );

  // Optionally add a secondary file stream logs/{fileName}.json
  let secondaryFileStream: pino.DestinationStream | undefined;
  if ( fileName && fileName.trim() ) {
    const safeName = normalizeLogFileName( fileName, useNdjson );
    const specificLogFilePath = path.join( projectRoot, "logs", safeName );
    ensureFile( specificLogFilePath, "" );
    secondaryFileStream = useNdjson
      ? createFileDestination( specificLogFilePath, environment === "development" )
      : createJsonArrayFileDestination( specificLogFilePath );
  }

  const enableStdout = (() => {
    try {
      const raw = String( process.env.LOG_STDOUT ?? "true" ).trim().toLowerCase();
      return ![ "false", "0", "no", "off" ].includes( raw );
    } catch {
      return true;
    }
  })();

  const loggerInstance = pino(
    {
      level: logLevel,
      base: { service: serviceName, env: environment, pid: process.pid, hostname: os.hostname() },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "msg",
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      /* Redact common sensitive keys if accidentally logged */
      redact: {
        paths: [
          "*.password",
          "*.apiKey",
          "*.token",
          "*.secret",
          "req.headers.authorization",
        ],
        censor: "[*****]",
      },
    },
    pino.multistream( (() => {
      const streams: Array<{ stream: pino.DestinationStream }> = [
        { stream: fileStream },
        ...(secondaryFileStream ? [ { stream: secondaryFileStream } ] : []),
      ];
      if ( enableStdout ) streams.push( { stream: stdoutStream } );
      return streams;
    })() )
  );
  cachedByFileName.set( cacheKey, loggerInstance );
  return loggerInstance;
}

// Create a callable logger that proxies to getLogger while exposing default logger methods
type LoggerCallable = ((arg?: string | LoggerOptions) => AppLogger) & AppLogger;

const defaultLoggerInstance: AppLogger = getLogger();

export const logger: LoggerCallable = makeCallable(
  (...args: unknown[]) => {
    const first = args[0] as unknown as string | LoggerOptions | undefined;
    return first === undefined ? getLogger() : (getLogger as any)( first );
  },
  defaultLoggerInstance,
) as unknown as LoggerCallable;


