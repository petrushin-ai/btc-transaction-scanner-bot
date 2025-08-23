import pino, { Logger as PinoLogger } from "pino";
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

  const transport = logPretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          singleLine: false,
          messageFormat: "{msg}",
          ignore: "pid,hostname",
        },
      }
    : undefined;

  cached = pino({
    level: logLevel,
    base: { service: serviceName, env: environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(transport ? { transport } : {}),
  });
  return cached;
}

// Eagerly initialize a singleton for ergonomic named import usage
export const logger: AppLogger = getLogger();


