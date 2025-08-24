import { fetchJson, HTTP_METHOD } from "@/application/helpers/http";
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
    this.backoffMs = options.backoffMs ?? ((n) => Math.min( 2000, 250 * n ));
  }

  async send(event: AddressActivityFoundEvent): Promise<SinkResult> {
    let attempt = 0;
    const body = JSON.stringify( event );
    while ( true ) {
      attempt += 1;
      try {
        await fetchJson<void>( this.url, {
          method: HTTP_METHOD.POST,
          headers: this.headers,
          body,
          timeoutMs: 5000,
        } );
        return { ok: true };
      } catch ( err ) {
        const error = err instanceof Error ? err : new Error( String( err ) );
        // crude status extraction from message for retry on 5xx
        const message = error.message || "";
        const match = message.match( /\s(\d{3})\s/ );
        const status = match ? Number( match[1] ) : undefined;
        if ( status && status >= 500 && attempt <= this.maxRetries ) {
          await new Promise( (r) => setTimeout( r, this.backoffMs( attempt ) ) );
          continue;
        }
        if ( attempt <= this.maxRetries ) {
          await new Promise( (r) => setTimeout( r, this.backoffMs( attempt ) ) );
          continue;
        }
        return { ok: false, error };
      }
    }
  }
}


