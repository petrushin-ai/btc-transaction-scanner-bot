import { loadEnvFiles } from "./env";
import fs from "fs";
import path from "path";
import envSchema from "env-schema";
import Ajv from "ajv";
import addFormats from "ajv-formats";

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
  // coinapi
  coinApiBaseUrl: string;
  coinApiApiKey: string;
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
  // Validate environment variables before reading them
  const ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: false });
  addFormats(ajv);
  try {
    const schema = {
      type: "object",
      required: [
        "BITCOIN_RPC_URL", 
        "BITCOIN_RPC_USER", 
        "BITCOIN_RPC_PASSWORD", 
        "COINAPI_BASE_URL",
        "API_KEY_APIBRICKS_COINAPI"
      ],
      additionalProperties: false,
      properties: {
        BITCOIN_RPC_URL: {
          type: "string",
          allOf: [
            { format: "uri" },
            { pattern: "^https?://" },
          ],
        },
        BITCOIN_RPC_USER: { type: "string", minLength: 1 },
        BITCOIN_RPC_PASSWORD: { type: "string", minLength: 1 },
        BITCOIN_POLL_INTERVAL_MS: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]+$" },
          ],
        },
        COINAPI_BASE_URL: {
          type: "string",
          allOf: [
            { format: "uri" },
            { pattern: "^https?://" },
          ],
        },
        RESOLVE_INPUT_ADDRESSES: {
          anyOf: [
            { type: "boolean" },
            { type: "string", enum: ["true", "false", "TRUE", "FALSE", "True", "False", ""] },
          ],
        },
        WATCH_ADDRESSES_FILE: { type: "string" },
        WATCH_ADDRESSES: { type: "string" },
        APP_ENV: { type: "string" },
        NODE_ENV: { type: "string" },
        LOG_SERVICE_NAME: { type: "string" },
        LOG_LEVEL: { type: "string" },
        LOG_PRETTY: {
          anyOf: [
            { type: "boolean" },
            { type: "string", enum: ["true", "false", "TRUE", "FALSE", "True", "False", ""] },
          ],
        },
        API_KEY_APIBRICKS_COINAPI: { type: "string", minLength: 1 },
        COINAPI_BASE_URL: {
          type: "string",
          allOf: [
            { format: "uri" },
            { pattern: "^https?://" },
          ],
        },
      },
    } as const;

    const allowedKeys = Object.keys(schema.properties as Record<string, unknown>);
    const envData: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(process.env, key)) {
        const value = process.env[key];
        envData[key] = typeof value === "string" ? value.trim() : value;
      }
    }

    const valid = ajv.validate(schema as any, envData);
    if (!valid) {
      const errors = (ajv.errors || []).map((e) => {
        const key = e.instancePath?.replace(/^\//, "") || (e.params as any)?.missingProperty || e.keyword;
        const msg = e.message || "invalid value";
        return `- ${key}: ${msg}`;
      });
      const details = errors.length > 0 ? `\n${errors.join("\n")}` : "";
      throw new Error(`Environment validation failed:${details}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Environment validation failed: ${message}`);
  }
  const cwd = process.cwd();
  const addressesFile = (process.env.WATCH_ADDRESSES_FILE || path.join(cwd, "addresses.json")).trim();
  const bitcoinRpcUrl = (process.env.BITCOIN_RPC_URL as string).trim();
  const bitcoinRpcUser = process.env.BITCOIN_RPC_USER?.trim();
  const bitcoinRpcPassword = process.env.BITCOIN_RPC_PASSWORD?.trim();
  const pollIntervalMs = Number((process.env.BITCOIN_POLL_INTERVAL_MS || "1000").toString().trim());
  const resolveInputAddresses = (process.env.RESOLVE_INPUT_ADDRESSES ?? "").toString().toLowerCase().trim() === "true";
  const environment = (process.env.APP_ENV || process.env.NODE_ENV || "development").toString().trim();
  const serviceName = (process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot").toString().trim();
  const defaultLevel = environment === "development" ? "debug" : "info";
  const logLevel = (process.env.LOG_LEVEL || defaultLevel).toString().trim();
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toString().toLowerCase().trim() === "true";
  const coinApiApiKey = (process.env.API_KEY_APIBRICKS_COINAPI as string).trim();
  const coinApiBaseUrl = (process.env.COINAPI_BASE_URL || "https://rest.coinapi.io").toString().trim();
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
    coinApiBaseUrl,
    coinApiApiKey,
  };
}

