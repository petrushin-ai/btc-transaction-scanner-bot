import { logger } from "@/infrastructure/logger";
import type { AddressActivityFoundEvent } from "@/types/events";

import type { NatsSinkOptions, NotificationSink, SinkResult } from "./types";

export class NatsSink implements NotificationSink {
  public readonly kind = "nats" as const;
  private readonly options: NatsSinkOptions;

  constructor(options: NatsSinkOptions) {
    this.options = options;
  }

  async send(_event: AddressActivityFoundEvent): Promise<SinkResult> {
    logger.warn( {
      type: "sink.unavailable",
      sink: this.kind,
      msg: "NATS sink is a stub; install client and implement publisher"
    } );
    return { ok: true };
  }
}


