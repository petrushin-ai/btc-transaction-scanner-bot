import os from "os";
import path from "path";
import pino, { Logger as PinoLogger } from "pino";

import { loadEnvFiles } from "../../config/env";
import {
  buildStdoutStream,
  createFileDestination,
  createJsonArrayFileDestination,
  ensureFile,
  findProjectRoot,
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

  const cacheKey = `${fileName || "__default__"}::ndjson=${useNdjson ? "1" : "0"}`;
  const existing = cachedByFileName.get(cacheKey);
  if (existing) return existing;
  // Load .env files without performing any validation. This avoids coupling the
  // logger to the validated application config and allows graceful defaults.
  loadEnvFiles();

  const { environment, serviceName, logLevel, logPretty } = getLoggingEnv();

  // Resolve the project root (the nearest directory containing package.json)
  const projectRoot = findProjectRoot(process.cwd());

  // Ensure directory and file exist for consistent behavior across environments

  // Build multi-destination streams: always output to logs/output[.json|.ndjson] and stdout
  const defaultLogFile = useNdjson ? "output.ndjson" : "output.json";
  const logFilePath = path.join(projectRoot, "logs", defaultLogFile);
  ensureFile(logFilePath, "");
  const fileStream = useNdjson
    ? createFileDestination(logFilePath, environment === "development")
    : createJsonArrayFileDestination(logFilePath);
  const stdoutStream = buildStdoutStream(logPretty);

  // Optionally add a secondary file stream logs/{fileName}.json
  let secondaryFileStream: pino.DestinationStream | undefined;
  if (fileName && fileName.trim()) {
    const safeName = normalizeLogFileName(fileName, useNdjson);
    const specificLogFilePath = path.join(projectRoot, "logs", safeName);
    ensureFile(specificLogFilePath, "");
    secondaryFileStream = useNdjson
      ? createFileDestination(specificLogFilePath, environment === "development")
      : createJsonArrayFileDestination(specificLogFilePath);
  }

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
      hooks: {
        logMethod(args, method) {
          // Central gating by environment:
          // - production: hide debug-level poll/health/summary/op_return logs
          // - development: show everything per level
          try {
            const env = environment;
            if (env === "production" && typeof args[0] === "object" && args[0] !== null) {
              const obj = args[0] as any;
              const type = obj.type as string | undefined;
              const isDebugCandidate = [
                "poll.start",
                "poll.tick",
                "poll.new_block",
                "block.activities",
                "transaction.op_return",
                "health",
              ].includes(type || "");
              if (isDebugCandidate && method === (this as any).debug) {
                return; // skip
              }
              // Additionally, if these came in at info level, down-gate them in prod
              if (isDebugCandidate && (method === (this as any).info)) {
                return; // skip info-level noisy types in production
              }
            }
          } catch {}
          method.apply(this, args as any);
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
    pino.multistream([
      { stream: fileStream },
      ...(secondaryFileStream ? [ { stream: secondaryFileStream } ] : []),
      { stream: stdoutStream },
    ])
  );
  cachedByFileName.set(cacheKey, loggerInstance);
  return loggerInstance;
}

// Create a callable logger that proxies to getLogger while exposing default logger methods
type LoggerCallable = ((arg?: string | LoggerOptions) => AppLogger) & AppLogger;

const defaultLoggerInstance: AppLogger = getLogger();

export const logger: LoggerCallable = makeCallable(
  (...args: unknown[]) => {
    const first = args[0] as unknown as string | LoggerOptions | undefined;
    return first === undefined ? getLogger() : (getLogger as any)(first);
  },
  defaultLoggerInstance,
) as unknown as LoggerCallable;


