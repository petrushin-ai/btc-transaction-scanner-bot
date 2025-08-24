import Ajv from "ajv";
import addFormats from "ajv-formats";
import path from "path";

import {getFileStorage} from "@/infrastructure/storage/FileStorageService";

import {loadEnvFiles} from "./env";

export type AppConfig = {
  bitcoinRpcUrl: string;
  pollIntervalMs: number;
  resolveInputAddresses: boolean;
  parseRawBlocks: boolean;
  maxEventQueueSize: number;
  // horizontal workers
  worker: { id: string; members: string[] };
  watch: { address: string; label?: string }[];
  // logger
  environment: string;
  serviceName: string;
  logLevel: string;
  logPretty: boolean;
  coinMarketCapApiKey: string;
  // sinks
  sinks: {
    enabled: string[];
    stdout?: { pretty?: boolean };
    file?: { path: string };
    webhook?: { url: string; headers?: Record<string, string>; maxRetries?: number };
    kafka?: { brokers: string[]; topic: string };
    nats?: { url: string; subject: string };
  };
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
      return {address, label};
    });
}

export function loadConfig(): AppConfig {
  loadEnvFiles();
  // Validate environment variables before reading them
  const ajv = new Ajv({allErrors: true, coerceTypes: true, useDefaults: false});
  addFormats(ajv);
  try {
    const schema = {
      type: "object",
      required: [
        "BTC_RPC_API_URL"
      ],
      additionalProperties: false,
      properties: {
        API_KEY_COINMARKETCAP: {type: "string"},
        BTC_RPC_API_URL: {
          type: "string",
          allOf: [
            {format: "uri"},
            {pattern: "^https?://"},
          ],
        },
        MAX_EVENT_QUEUE_SIZE: {
          anyOf: [
            {type: "integer", minimum: 1},
            {type: "string", pattern: "^[0-9]+$"},
          ],
        },
        BITCOIN_POLL_INTERVAL_MS: {
          anyOf: [
            {type: "integer", minimum: 1},
            {type: "string", pattern: "^[0-9]+$"},
          ],
        },
        COINMARKETCAP_BASE_URL: { type: "string" },
        RESOLVE_INPUT_ADDRESSES: {
          anyOf: [
            {type: "boolean"},
            {type: "string", enum: ["true", "false", "TRUE", "FALSE", "True", "False", ""]},
          ],
        },
        PARSE_RAW_BLOCKS: {type: "boolean"},
        WATCH_ADDRESSES_FILE: {type: "string"},
        WATCH_ADDRESSES: {type: "string"},
        // Workers
        WORKER_ID: { type: "string" },
        WORKER_MEMBERS: { type: "string" },
        APP_ENV: {type: "string"},
        NODE_ENV: {type: "string"},
        LOG_SERVICE_NAME: {type: "string"},
        LOG_LEVEL: {type: "string"},
        LOG_PRETTY: {
          anyOf: [
            {type: "boolean"},
            {type: "string", enum: ["true", "false", "TRUE", "FALSE", "True", "False", ""]},
          ],
        },
        // Sinks
        SINKS_ENABLED: { type: "string" },
        SINK_STDOUT_PRETTY: { anyOf: [ {type: "boolean"}, {type: "string"} ] },
        SINK_FILE_PATH: { type: "string" },
        SINK_WEBHOOK_URL: { type: "string" },
        SINK_WEBHOOK_HEADERS: { type: "string" },
        SINK_WEBHOOK_MAX_RETRIES: { anyOf: [ {type: "integer"}, {type: "string"} ] },
        SINK_KAFKA_BROKERS: { type: "string" },
        SINK_KAFKA_TOPIC: { type: "string" },
        SINK_NATS_URL: { type: "string" },
        SINK_NATS_SUBJECT: { type: "string" },
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
        const key = e.instancePath
          ?.replace(/^\//, "") || (e.params as any)?.missingProperty || e.keyword;
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
  const addressesFile = (
    process.env.WATCH_ADDRESSES_FILE || path.join(cwd, "addresses.json")
  ).trim();
  const bitcoinRpcUrl = (process.env.BTC_RPC_API_URL as string).trim();
  const pollIntervalMs = Number((process.env.BITCOIN_POLL_INTERVAL_MS || "1000").toString().trim());
  const maxEventQueueSize = Number((process.env.MAX_EVENT_QUEUE_SIZE || "2000").toString().trim());
  const resolveInputAddresses = (
    process.env.RESOLVE_INPUT_ADDRESSES ?? ""
  ).toString().toLowerCase().trim() === "true";
  const parseRawBlocks = (process.env.PARSE_RAW_BLOCKS ?? "").toString().toLowerCase().trim() === "true";
  const environment = (
    process.env.APP_ENV || process.env.NODE_ENV || "development"
  ).toString().trim();
  const serviceName = (
    process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot"
  ).toString().trim();
  const defaultLevel = environment === "development" ? "debug" : "info";
  const logLevel = (process.env.LOG_LEVEL || defaultLevel).toString().trim();
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (process.env.LOG_PRETTY || prettyDefault).toString().toLowerCase().trim() === "true";
  const coinMarketCapApiKey = (process.env.API_KEY_COINMARKETCAP as string).trim();
  // sinks parsing
  const sinksEnabledCsv = (process.env.SINKS_ENABLED || "stdout").toString().trim();
  const enabled = sinksEnabledCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sinks = {
    enabled,
    stdout: { pretty: ((process.env.SINK_STDOUT_PRETTY || (logPretty ? "true" : "false")).toString().toLowerCase().trim() === "true") },
    file: process.env.SINK_FILE_PATH ? { path: (process.env.SINK_FILE_PATH as string).trim() } : undefined,
    webhook: process.env.SINK_WEBHOOK_URL ? {
      url: (process.env.SINK_WEBHOOK_URL as string).trim(),
      headers: process.env.SINK_WEBHOOK_HEADERS ? JSON.parse((process.env.SINK_WEBHOOK_HEADERS as string).trim()) : undefined,
      maxRetries: process.env.SINK_WEBHOOK_MAX_RETRIES ? Number((process.env.SINK_WEBHOOK_MAX_RETRIES as string).trim()) : undefined,
    } : undefined,
    kafka: process.env.SINK_KAFKA_BROKERS && process.env.SINK_KAFKA_TOPIC ? {
      brokers: (process.env.SINK_KAFKA_BROKERS as string).split(",").map((x) => x.trim()).filter(Boolean),
      topic: (process.env.SINK_KAFKA_TOPIC as string).trim(),
    } : undefined,
    nats: process.env.SINK_NATS_URL && process.env.SINK_NATS_SUBJECT ? {
      url: (process.env.SINK_NATS_URL as string).trim(),
      subject: (process.env.SINK_NATS_SUBJECT as string).trim(),
    } : undefined,
  } as const;
  // worker settings
  const workerId = (process.env.WORKER_ID || "worker-1").toString().trim();
  const workersCsv = (process.env.WORKER_MEMBERS || workerId).toString().trim();
  const workerMembers = workersCsv.split(",").map((x) => x.trim()).filter(Boolean);
  let watch: { address: string; label?: string }[] = [];
  try {
    const storage = getFileStorage();
    const fileContent = storage.readFile(addressesFile, "utf-8");
    const json = JSON.parse(fileContent);
    if (Array.isArray(json)) {
      watch = json.filter((x) => typeof x?.address === "string").map((x) => ({
        address: x.address,
        label: x.label
      }));
    }
  } catch {
    watch = parseWatchAddresses(process.env.WATCH_ADDRESSES);
  }
  return {
    bitcoinRpcUrl,
    pollIntervalMs,
    resolveInputAddresses,
    parseRawBlocks,
    maxEventQueueSize,
    worker: { id: workerId, members: workerMembers },
    watch,
    environment,
    serviceName,
    logLevel,
    logPretty,
    coinMarketCapApiKey,
    sinks,
  };
}

