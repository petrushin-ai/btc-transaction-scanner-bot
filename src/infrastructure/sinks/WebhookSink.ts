import type { AddressActivityFoundEvent } from "@/types/events";

import type { NotificationSink, SinkResult, WebhookSinkOptions } from "./types";

export class WebhookSink implements NotificationSink {
  public readonly kind = "webhook" as const;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(options: WebhookSinkOptions) {
    this.url = options.url;
    this.headers = options.headers || { "content-type": "application/json" };
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffMs = options.backoffMs ?? ((n) => Math.min(2000, 250 * n));
  }

  async send(event: AddressActivityFoundEvent): Promise<SinkResult> {
    let attempt = 0;
    const body = JSON.stringify(event);
    while (true) {
      attempt += 1;
      try {
        const res = await fetch(this.url, { method: "POST", headers: this.headers, body });
        if (res.ok) return { ok: true };
        if (res.status >= 500 && attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
          continue;
        }
        return { ok: false, error: new Error(`webhook ${res.status}`) };
      } catch (err) {
        if (attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
          continue;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        return { ok: false, error };
      }
    }
  }
}


