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
// Keep-Alive via undici per-origin pools (external)
// Internal logger
import { fetch as undiciFetch, Pool } from "undici";

import { logger } from "@/infrastructure/logger";

const httpLog = logger( "http" );

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

/**
 * Close all undici per-origin pools. Use during graceful shutdown to avoid keeping connections open
 */
export async function closeAllHttpPools(): Promise<void> {
  const closers: Promise<void>[] = [];
  for ( const [ , pool ] of originPools ) {
    try {
      // undici Pool has a close() that returns a promise
      closers.push( pool.close() );
    } catch {
      // ignore
    }
  }
  originPools.clear();
  if ( closers.length > 0 ) {
    try {
      await Promise.allSettled( closers );
    } catch { /* ignore */
    }
  }
}

function getPoolForUrl(url: string): Pool {
  const u = new URL( url );
  const origin = u.origin;
  let pool = originPools.get( origin );
  if ( pool ) return pool;
  const connections = keepAliveConfig
    .perHostConnections[u.hostname] ?? keepAliveConfig.defaultConnections;
  pool = new Pool( origin, {
    connections,
    pipelining: keepAliveConfig.pipelining,
    keepAliveTimeout: keepAliveConfig.keepAliveTimeoutMs,
    keepAliveMaxTimeout: keepAliveConfig.keepAliveMaxTimeoutMs,
  } );
  originPools.set( origin, pool );
  return pool;
}

export type FetchJsonOptions = {
  method?: HttpMethod;
  headers?: RequestHeaders;
  body?: unknown; // will be serialized if object/string provided
  timeoutMs?: number; // def: 5000
  signal?: AbortSignal;
};

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const method = opts.method || HTTP_METHOD.GET;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout( () => controller.abort(), timeoutMs );
  const headers: RequestHeaders = { ...JSON_HEADERS, ...(opts.headers || {}) };

  // Serializing body if provided and not already a string
  let body: string | undefined = undefined;
  let rpcSummary:
    | { kind: "rpc"; batch: boolean; methods: Array<{ name: string; count: number }> }
    | undefined;
  if ( opts.body !== undefined ) {
    if ( typeof opts.body === "string" ) body = opts.body;
    else {
      headers["content-type"] = headers["content-type"] || "application/json";
      // Best-effort summarize JSON-RPC request for logging
      try {
        const obj: any = opts.body as any;
        if ( Array.isArray( obj ) ) {
          const counts = new Map<string, number>();
          for ( const it of obj ) {
            const m = typeof it?.method === "string" ? it.method : "unknown";
            counts.set( m, (counts.get( m ) || 0) + 1 );
          }
          rpcSummary = {
            kind: "rpc",
            batch: true,
            methods: Array.from( counts ).map( ([ name, count ]) => ({ name, count }) ),
          };
        } else if ( obj && typeof obj === "object" && typeof obj.method === "string" ) {
          rpcSummary = {
            kind: "rpc",
            batch: false,
            methods: [ { name: String( obj.method ), count: 1 } ],
          };
        }
      } catch {
        // ignore summarization errors
      }
      body = JSON.stringify( opts.body );
    }
  }

  try {
    // Request log
    httpLog.debug( {
      type: "http.request",
      url,
      method,
      timeoutMs,
      rpc: rpcSummary,
      hasBody: !!body,
    } );
    const res = await undiciFetch( url, {
      method,
      headers,
      body,
      signal: opts.signal || controller.signal,
      // @ts-ignore - undici fetch supports dispatcher
      dispatcher: getPoolForUrl( url ),
    } as any );
    if ( !res.ok ) {
      const text = await res.text().catch( () => "" );
      // Mark last429 timestamp globally for callers that may want to backoff
      if ( res.status === 429 ) {
        // best-effort global mark; specific services can keep local state too
        (globalThis as any).__last429AtMs = Date.now();
      }
      httpLog.warn( {
        type: "http.response_error",
        url,
        method,
        status: res.status,
        statusText: res.statusText,
        rpc: rpcSummary,
      } );
      throw new Error(
        `${ method } ${ url } failed: ${ res.status } ${ res.statusText } ${ text }`.trim()
      );
    }
    // Try JSON parse, fall back to text if empty
    const contentType = res.headers.get( "content-type" ) || "";
    if ( contentType.includes( "app/json" ) ) {
      const json = (await res.json()) as T;
      httpLog.debug( {
        type: "http.response_ok",
        url,
        method,
        status: res.status,
        rpc: rpcSummary,
      } );
      return json;
    }
    // For JSON-RPC we always expect JSON, but handle gracefully
    const text = await res.text();
    httpLog.debug( {
      type: "http.response_text",
      url,
      method,
      status: res.status,
      rpc: rpcSummary,
    } );
    return (text ? (JSON.parse( text ) as T) : (undefined as unknown as T));
  } finally {
    clearTimeout( timeoutId );
  }
}


