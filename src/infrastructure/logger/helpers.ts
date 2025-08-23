import fs from "fs";
import path from "path";
import pino from "pino";

export type LoggingEnv = {
  environment: string;
  serviceName: string;
  logLevel: string;
  logPretty: boolean;
};

export function getLoggingEnv(): LoggingEnv {
  const environment = (process.env.APP_ENV || process.env.NODE_ENV || "development").trim();
  const serviceName = process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot";
  const defaultLevel = environment === "development" ? "debug" : "info";
  const logLevel = process.env.LOG_LEVEL || defaultLevel;
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toLowerCase() === "true";
  return { environment, serviceName, logLevel, logPretty };
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (fileExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

export function ensureFile(filePath: string, initialContent = ""): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {}
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, initialContent, { encoding: "utf-8", flag: "wx" });
    }
  } catch {}
}

export function normalizeJsonFileName(rawName: string): string {
  const base = path.basename(rawName.trim());
  const hasJson = base.toLowerCase().endsWith(".json");
  return hasJson ? base : `${base}.json`;
}

export function createFileDestination(filePath: string, isSync: boolean): pino.DestinationStream {
  return pino.destination({ dest: filePath, sync: isSync });
}

export function buildStdoutStream(logPretty: boolean): pino.DestinationStream {
  if (logPretty) {
    // Lazy require to avoid importing pretty in environments where it's not desired
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pinoPretty = require("pino-pretty");
    return pinoPretty({
      colorize: true,
      translateTime: "SYS:standard",
      singleLine: false,
      messageKey: "msg",
      ignore: "pid,hostname",
    });
  }
  return pino.destination(1);
}


