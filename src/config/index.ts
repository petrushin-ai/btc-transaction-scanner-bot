import path from "path";
import { z } from "zod";

import { normalizeWatchedAddresses } from "@/app/helpers/bitcoin";
import { getFileStorage } from "@/infrastructure/storage/FileStorageService";

import { loadEnvFiles } from "./env";

export type AppConfig = {
  bitcoinRpcUrl: string;
  pollIntervalMs: number;
  resolveInputAddresses: boolean;
  parseRawBlocks: boolean;
  // required network selection
  network: "mainnet" | "testnet" | "signet" | "regtest";
  maxEventQueueSize: number;
  // horizontal workers
  worker: { id: string; members: string[] };
  watch: { address: string; label?: string }[];
  // path to a watchlist file (if available)
  watchAddressesFile?: string;
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
  if ( !raw ) return [];
  // CSV format: address[:label],address[:label]
  return raw
    .split( "," )
    .map( (s) => s.trim() )
    .filter( Boolean )
    .map( (item) => {
      const [ address, label ] = item.split( ":" );
      return { address, label };
    } );
}

export function loadConfig(): AppConfig {
  const smoke = (() => {
    const raw = (process.env.SMOKE_TEST || "").toString().trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  })();
  if ( smoke ) {
    const cwd = process.cwd();
    return {
      bitcoinRpcUrl: "http://localhost:8332",
      pollIntervalMs: 1000,
      resolveInputAddresses: false,
      parseRawBlocks: false,
      network: ((process.env.BTC_NETWORK || "regtest") as any),
      maxEventQueueSize: 100,
      worker: { id: "worker-1", members: [ "worker-1" ] },
      watch: [],
      watchAddressesFile: `${ cwd }/addresses.json`,
      environment: (process.env.APP_ENV || process.env.NODE_ENV || "production")
        .toString().trim(),
      serviceName: (
        process.env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot")
        .toString().trim(),
      logLevel: (process.env.LOG_LEVEL || "info")
        .toString().trim(),
      logPretty: false,
      coinMarketCapApiKey: "",
      sinks: {
        enabled: [ "stdout" ],
        stdout: { pretty: false },
      },
    };
  }
  loadEnvFiles();
  // Zod schema for process.env
  const envSchema = z.object( {
    API_KEY_COINMARKETCAP: z.string().optional(),
    BTC_RPC_API_URL: z.string()
      .url( { message: "must be a valid URL" } )
      .regex( /^https?:\/\//, { message: "must start with http:// or https://" } ),
    MAX_EVENT_QUEUE_SIZE: z.coerce.number().int().min( 1 ).default( 2000 ),
    BTC_POLL_INTERVAL_MS: z.coerce.number().int().min( 1 ).default( 1000 ),
    COINMARKETCAP_BASE_URL: z.string().optional(),
    RESOLVE_INPUT_ADDRESSES: z.coerce.boolean().optional().default( false ),
    PARSE_RAW_BLOCKS: z.coerce.boolean().optional().default( false ),
    WATCH_ADDRESSES_FILE: z.string().optional(),
    WATCH_ADDRESSES: z.string().optional(),
    // Workers
    WORKER_ID: z.string().optional().default( "worker-1" ),
    WORKER_MEMBERS: z.string().optional(),
    APP_ENV: z.string().optional(),
    NODE_ENV: z.string().optional(),
    LOG_SERVICE_NAME: z.string().optional().default( "btc-transaction-scanner-bot" ),
    LOG_LEVEL: z.string().optional(),
    LOG_PRETTY: z.union( [ z.string(), z.boolean() ] ).optional(),
    // Sinks
    SINKS_ENABLED: z.string().optional().default( "stdout" ),
    SINK_STDOUT_PRETTY: z.union( [ z.string(), z.boolean() ] ).optional(),
    SINK_FILE_PATH: z.string().optional(),
    SINK_WEBHOOK_URL: z.url().optional(),
    SINK_WEBHOOK_HEADERS: z.string().optional(),
    SINK_WEBHOOK_MAX_RETRIES: z.union( [ z.coerce.number().int(), z.string() ] ).optional(),
    SINK_KAFKA_BROKERS: z.string().optional(),
    SINK_KAFKA_TOPIC: z.string().optional(),
    SINK_NATS_URL: z.string().optional(),
    SINK_NATS_SUBJECT: z.string().optional(),
    BTC_NETWORK: z.enum( [ "mainnet", "testnet", "signet", "regtest" ] ),
  } );

  const result = envSchema.safeParse( process.env );
  if ( !result.success ) {
    const tips: Record<string, string> = {
      BTC_RPC_API_URL: "Set BTC_RPC_API_URL to http(s)://host:port, e.g. http://localhost:8332",
      BTC_POLL_INTERVAL_MS: "Use a positive integer; defaults to 1000 if unset",
      MAX_EVENT_QUEUE_SIZE: "Use a positive integer; defaults to 2000 if unset",
      RESOLVE_INPUT_ADDRESSES: "Use true or false",
      PARSE_RAW_BLOCKS: "Use true or false",
      BTC_NETWORK: "Set to mainnet, testnet, signet, or regtest",
      LOG_PRETTY: "Use true or false (defaults to true in development)",
      SINKS_ENABLED: "CSV list of enabled sinks, e.g. stdout,file,webhook",
      SINK_KAFKA_BROKERS: "CSV list of brokers, e.g. localhost:9092,broker:9092",
      SINK_WEBHOOK_HEADERS: "JSON object string, e.g. {\"Authorization\":\"Bearer ...\"}",
    };
    const details = result.error.issues.map( (issue) => {
      const keyName = String( issue.path[0] ?? issue.code );
      const tip = tips[keyName] ? ` Tip: ${ tips[keyName] }.` : "";
      return `- ${ keyName }: ${ issue.message }.${ tip }`;
    } ).join( "\n" );
    throw new Error( `Environment validation failed:\n${ details }` );
  }
  const env = result.data;
  const cwd = process.cwd();
  const addressesFile = (
    env.WATCH_ADDRESSES_FILE || path.join( cwd, "addresses.json" )
  ).trim();
  const bitcoinRpcUrl = env.BTC_RPC_API_URL.trim();
  const pollIntervalMs = Number( env.BTC_POLL_INTERVAL_MS );
  const network = env.BTC_NETWORK;
  const maxEventQueueSize = Number( env.MAX_EVENT_QUEUE_SIZE );
  const resolveInputAddresses = Boolean( env.RESOLVE_INPUT_ADDRESSES );
  const parseRawBlocks = Boolean( env.PARSE_RAW_BLOCKS );
  const environment = (
    env.APP_ENV || env.NODE_ENV || "development"
  ).toString().trim();
  const serviceName = (
    env.LOG_SERVICE_NAME || "btc-transaction-scanner-bot"
  ).toString().trim();
  const defaultLevel = environment === "development" ? "trace" : "info";
  const logLevel = (env.LOG_LEVEL || defaultLevel).toString().trim();
  const prettyDefault = environment === "development" ? "true" : "false";
  const logPretty = (env.LOG_PRETTY ?? prettyDefault).toString().toLowerCase().trim() === "true";
  const coinMarketCapApiKey = (env.API_KEY_COINMARKETCAP || "").toString().trim();
  // sinks parsing
  const sinksEnabledCsv = (env.SINKS_ENABLED || "stdout").toString().trim();
  const enabled = sinksEnabledCsv
    .split( "," )
    .map( (s) => s.trim() )
    .filter( Boolean );
  const sinks = {
    enabled,
    stdout: {
      pretty: (
        (
          (
            env.SINK_STDOUT_PRETTY
            ?? (logPretty ? "true" : "false"
            )
          ).toString().toLowerCase().trim() === "true")
      )
    },
    file: env.SINK_FILE_PATH ? { path: env.SINK_FILE_PATH.trim() } : undefined,
    webhook: env.SINK_WEBHOOK_URL ? {
      url: env.SINK_WEBHOOK_URL.trim(),
      headers: env.SINK_WEBHOOK_HEADERS ? (() => {
        try {
          return JSON.parse( env.SINK_WEBHOOK_HEADERS.trim() );
        } catch {
          throw new Error( "Environment validation failed: - SINK_WEBHOOK_HEADERS: must be valid JSON. Tip: e.g. {\"Authorization\":\"Bearer ...\"}" );
        }
      })() : undefined,
      maxRetries: env.SINK_WEBHOOK_MAX_RETRIES
        ? Number( env.SINK_WEBHOOK_MAX_RETRIES.toString().trim() )
        : undefined,
    } : undefined,
    kafka: env.SINK_KAFKA_BROKERS && env.SINK_KAFKA_TOPIC ? {
      brokers: env.SINK_KAFKA_BROKERS.split( "," ).map( (x) => x.trim() ).filter( Boolean ),
      topic: env.SINK_KAFKA_TOPIC.trim(),
    } : undefined,
    nats: env.SINK_NATS_URL && env.SINK_NATS_SUBJECT ? {
      url: env.SINK_NATS_URL.trim(),
      subject: env.SINK_NATS_SUBJECT.trim(),
    } : undefined,
  } as const;
  // worker settings
  const workerId = (env.WORKER_ID || "worker-1").toString().trim();
  const workersCsv = (env.WORKER_MEMBERS || workerId).toString().trim();
  const workerMembers = workersCsv.split( "," ).map( (x) => x.trim() ).filter( Boolean );
  let watch: { address: string; label?: string }[] = [];
  try {
    const storage = getFileStorage();
    const fileContent = storage.readFile( addressesFile, "utf-8" );
    const json = JSON.parse( fileContent );
    if ( Array.isArray( json ) ) {
      const items = json.filter( (x) => typeof x?.address === "string" ).map( (x) => ({
        address: x.address,
        label: x.label
      }) );
      watch = normalizeWatchedAddresses( items, network as any );
    }
  } catch {
    watch = normalizeWatchedAddresses( parseWatchAddresses( env.WATCH_ADDRESSES ), network as any );
  }
  return {
    bitcoinRpcUrl,
    pollIntervalMs,
    resolveInputAddresses,
    parseRawBlocks,
    network,
    maxEventQueueSize,
    worker: { id: workerId, members: workerMembers },
    watch,
    watchAddressesFile: addressesFile,
    environment,
    serviceName,
    logLevel,
    logPretty,
    coinMarketCapApiKey,
    sinks,
  };
}

