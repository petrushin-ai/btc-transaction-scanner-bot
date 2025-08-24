export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const HTTP_METHOD = {
  GET: "GET" as HttpMethod,
  POST: "POST" as HttpMethod,
  PUT: "PUT" as HttpMethod,
  PATCH: "PATCH" as HttpMethod,
  DELETE: "DELETE" as HttpMethod,
};

export type RequestHeaders = Record<string, string>;

export const JSON_HEADERS: RequestHeaders = {
  "Accept": "application/json",
};

// Keep-Alive via undici per-origin pools
import {fetch as undiciFetch, Pool} from "undici";

type KeepAliveConfig = {
  defaultConnections: number;
  perHostConnections: Record<string, number>;
  keepAliveTimeoutMs: number;
  keepAliveMaxTimeoutMs: number;
  pipelining: number;
};

let keepAliveConfig: KeepAliveConfig = {
  defaultConnections: 8,
  perHostConnections: {},
  keepAliveTimeoutMs: 30000,
  keepAliveMaxTimeoutMs: 60000,
  pipelining: 1,
};

const originPools = new Map<string, Pool>();

export function configureHttpKeepAlive(cfg: Partial<KeepAliveConfig>): void {
  keepAliveConfig = {
    ...keepAliveConfig,
    ...cfg,
    perHostConnections: {
      ...keepAliveConfig.perHostConnections,
      ...(cfg.perHostConnections || {}),
    },
  };
}

function getPoolForUrl(url: string): Pool {
  const u = new URL(url);
  const origin = u.origin;
  let pool = originPools.get(origin);
  if (pool) return pool;
  const connections = keepAliveConfig.perHostConnections[u.hostname] ?? keepAliveConfig.defaultConnections;
  pool = new Pool(origin, {
    connections,
    pipelining: keepAliveConfig.pipelining,
    keepAliveTimeout: keepAliveConfig.keepAliveTimeoutMs,
    keepAliveMaxTimeout: keepAliveConfig.keepAliveMaxTimeoutMs,
  });
  originPools.set(origin, pool);
  return pool;
}

export type FetchJsonOptions = {
  method?: HttpMethod;
  headers?: RequestHeaders;
  body?: unknown; // will be JSON.stringified if object/string provided
  timeoutMs?: number; // default 5000
  signal?: AbortSignal;
};

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const method = opts.method || HTTP_METHOD.GET;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers: RequestHeaders = {...JSON_HEADERS, ...(opts.headers || {})};

  // Stringify body if provided and not already a string
  let body: string | undefined = undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string") body = opts.body;
    else {
      headers["content-type"] = headers["content-type"] || "application/json";
      body = JSON.stringify(opts.body);
    }
  }

  try {
    const res = await undiciFetch(url, {
      method,
      headers,
      body,
      signal: opts.signal || controller.signal,
      // @ts-ignore - undici fetch supports dispatcher
      dispatcher: getPoolForUrl(url),
    } as any);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText} ${text}`.trim());
    }
    // Try JSON parse, fall back to text if empty
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    // For JSON-RPC we always expect json, but handle gracefully
    const text = await res.text();
    return (text ? (JSON.parse(text) as T) : (undefined as unknown as T));
  } finally {
    clearTimeout(timeoutId);
  }
}


