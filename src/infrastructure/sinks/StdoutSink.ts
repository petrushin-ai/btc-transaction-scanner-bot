import { logger } from "@/infrastructure/logger";
import type { AddressActivityFoundEvent } from "@/types/events";

import type { NotificationSink, SinkResult, StdoutSinkOptions } from "./types";

export class StdoutSink implements NotificationSink {
  public readonly kind = "stdout" as const;
  private readonly pretty: boolean;

  constructor(options?: StdoutSinkOptions) {
    this.pretty = options?.pretty ?? false;
  }

  async send(event: AddressActivityFoundEvent): Promise<SinkResult> {
    try {
      const sign = event.activity.direction === "in" ? 1 : -1;
      const diffBtc = sign * event.activity.valueBtc;
      const valueUsd = event.activity.valueUsd;
      const diffUsd = typeof valueUsd === "number" ? sign * valueUsd : undefined;
      const payload = {
        type: "transaction.activity",
        address: event.activity.address,
        txid: event.activity.txid,
        valueBtc: event.activity.valueBtc,
        valueUsd,
        diffBtc,
        diffUsd,
        direction: event.activity.direction,
        block: event.block,
        timestamp: event.timestamp,
      } as const;
      if ( this.pretty ) {
        // log prettified summary
        logger.info( {
          type: "transaction.activity",
          address: payload.address,
          txid: payload.txid,
          valueBtc: payload.valueBtc,
          valueUsd: payload.valueUsd,
          diffBtc: payload.diffBtc,
          diffUsd: payload.diffUsd,
          direction: payload.direction,
          block: payload.block
        } );
      } else {
        // a structured JSON line
        // Avoids circulars; the event is plain already
        logger.info( payload );
      }
      return { ok: true };
    } catch ( err ) {
      const error = err instanceof Error ? err : new Error( String( err ) );
      logger.error( { type: "sink.error", sink: this.kind, error: error.message } );
      return { ok: false, error };
    }
  }
}


