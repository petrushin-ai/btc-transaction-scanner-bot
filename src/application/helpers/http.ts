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
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: opts.signal || controller.signal,
    });
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


