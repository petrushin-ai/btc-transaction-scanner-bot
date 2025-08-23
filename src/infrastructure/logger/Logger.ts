import pino, { Logger as PinoLogger } from "pino";
import { loadConfig } from "../../config";

export type AppLogger = PinoLogger;

let cached: AppLogger | undefined;

export function getLogger(): AppLogger {
  if (cached) return cached;
  const cfg = loadConfig();

  const transport = cfg.logPretty
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
    level: cfg.logLevel,
    base: { service: cfg.serviceName, env: cfg.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(transport ? { transport } : {}),
  });
  return cached;
}


