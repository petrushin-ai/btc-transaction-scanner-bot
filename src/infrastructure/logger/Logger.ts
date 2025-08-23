import pino, { Logger as PinoLogger } from "pino";
import pinoPretty from "pino-pretty";
import path from "path";
import fs from "fs";
import os from "os";
import { loadEnvFiles } from "../../config/env";

export type AppLogger = PinoLogger;

let cached: AppLogger | undefined;

export function getLogger(): AppLogger {
  if (cached) return cached;
  // Load .env files without performing any validation. This avoids coupling the
  // logger to the validated application config and allows graceful defaults.
  loadEnvFiles();

  const environment = (process.env.APP_ENV || process.env.NODE_ENV || "development").trim();
  const serviceName = process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot";
  const defaultLevel = environment === "development" ? "debug" : "info";
  const logLevel = process.env.LOG_LEVEL || defaultLevel;
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toLowerCase() === "true";

  // Resolve project root (nearest directory containing package.json) to ensure a single global logs/output.json
  function fileExists(p: string): boolean {
    try {
      fs.accessSync(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  function findProjectRoot(startDir: string): string {
    let current = startDir;
    while (true) {
      if (fileExists(path.join(current, "package.json"))) return current;
      const parent = path.dirname(current);
      if (parent === current) return startDir;
      current = parent;
    }
  }
  const projectRoot = findProjectRoot(process.cwd());

  // Build multi-destination stream: write structured NDJSON to root logs/output.json, and JSON/pretty to stdout.
  const logFilePath = path.join(projectRoot, "logs", "output.json");
  const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: environment === "development" });
  const stdoutStream = logPretty
    ? pinoPretty({
        colorize: true,
        translateTime: "SYS:standard",
        singleLine: false,
        messageKey: "msg",
        ignore: "pid,hostname",
      })
    : pino.destination(1);

  cached = pino(
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
      { stream: stdoutStream },
    ])
  );
  return cached;
}

// Eagerly initialize a singleton for ergonomic named import usage
export const logger: AppLogger = getLogger();


