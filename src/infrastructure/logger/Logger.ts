import pino, { Logger as PinoLogger } from "pino";
import path from "path";
import os from "os";
import { loadEnvFiles } from "../../config/env";
import {
  getLoggingEnv,
  findProjectRoot,
  ensureFile,
  normalizeJsonFileName,
  createFileDestination,
  buildStdoutStream,
} from "./helpers";

export type AppLogger = PinoLogger;

const cachedByFileName: Map<string, AppLogger> = new Map();

export function getLogger(fileName?: string): AppLogger {
  const cacheKey = (fileName && fileName.trim()) ? fileName.trim() : "__default__";
  const existing = cachedByFileName.get(cacheKey);
  if (existing) return existing;
  // Load .env files without performing any validation. This avoids coupling the
  // logger to the validated application config and allows graceful defaults.
  loadEnvFiles();

  const { environment, serviceName, logLevel, logPretty } = getLoggingEnv();

  // Resolve project root (nearest directory containing package.json) to ensure a single global logs dir
  const projectRoot = findProjectRoot(process.cwd());

  // Ensure directory and file exist for consistent behavior across environments

  // Build multi-destination streams: always output to logs/output.json and stdout
  const logFilePath = path.join(projectRoot, "logs", "output.json");
  ensureFile(logFilePath, "");
  const fileStream = createFileDestination(logFilePath, environment === "development");
  const stdoutStream = buildStdoutStream(logPretty);

  // Optionally add a secondary file stream logs/{fileName}.json
  let secondaryFileStream: pino.DestinationStream | undefined;
  if (fileName && fileName.trim()) {
    const safeName = normalizeJsonFileName(fileName);
    const specificLogFilePath = path.join(projectRoot, "logs", safeName);
    ensureFile(specificLogFilePath, "");
    secondaryFileStream = createFileDestination(specificLogFilePath, environment === "development");
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
      /* Redact common sensitive keys if accidentally logged */
      redact: {
        paths: [
          "*.password",
          "*.apiKey",
          "*.token",
          "*.secret",
          "req.headers.authorization",
        ],
        censor: "[Redacted]",
      },
    },
    pino.multistream([
      { stream: fileStream },
      ...(secondaryFileStream ? [{ stream: secondaryFileStream }] : []),
      { stream: stdoutStream },
    ])
  );
  cachedByFileName.set(cacheKey, loggerInstance);
  return loggerInstance;
}

// Eagerly initialize a singleton for ergonomic named import usage
export const logger: AppLogger = getLogger();


