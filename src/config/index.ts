import { loadEnvFiles } from "./env";
import fs from "fs";
import path from "path";

export type AppConfig = {
  bitcoinRpcUrl: string;
  bitcoinRpcUser?: string;
  bitcoinRpcPassword?: string;
  pollIntervalMs: number;
  resolveInputAddresses: boolean;
  watch: { address: string; label?: string }[];
  // logger
  environment: string;
  serviceName: string;
  logLevel: string;
  logPretty: boolean;
};

function parseWatchAddresses(raw: string | undefined): { address: string; label?: string }[] {
  if (!raw) return [];
  // CSV format: address[:label],address[:label]
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [address, label] = item.split(":");
      return { address, label };
    });
}

export function loadConfig(): AppConfig {
  loadEnvFiles();
  const cwd = process.cwd();
  const addressesFile = process.env.WATCH_ADDRESSES_FILE || path.join(cwd, "addresses.json");
  const bitcoinRpcUrl = process.env.BITCOIN_RPC_URL || "http://localhost:8332";
  const bitcoinRpcUser = process.env.BITCOIN_RPC_USER;
  const bitcoinRpcPassword = process.env.BITCOIN_RPC_PASSWORD;
  const pollIntervalMs = Number(process.env.BITCOIN_POLL_INTERVAL_MS || 1000);
  const resolveInputAddresses = (process.env.RESOLVE_INPUT_ADDRESSES || "false").toLowerCase() === "true";
  const environment = (process.env.APP_ENV || process.env.NODE_ENV || "development").trim();
  const serviceName = process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot";
  const defaultLevel = environment === "development" ? "debug" : "info";
  const logLevel = process.env.LOG_LEVEL || defaultLevel;
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toLowerCase() === "true";
  let watch: { address: string; label?: string }[] = [];
  try {
    const fileContent = fs.readFileSync(addressesFile, "utf-8");
    const json = JSON.parse(fileContent);
    if (Array.isArray(json)) {
      watch = json.filter((x) => typeof x?.address === "string").map((x) => ({ address: x.address, label: x.label }));
    }
  } catch {
    watch = parseWatchAddresses(process.env.WATCH_ADDRESSES);
  }
  return {
    bitcoinRpcUrl,
    bitcoinRpcUser,
    bitcoinRpcPassword,
    pollIntervalMs,
    resolveInputAddresses,
    watch,
    environment,
    serviceName,
    logLevel,
    logPretty,
  };
}

