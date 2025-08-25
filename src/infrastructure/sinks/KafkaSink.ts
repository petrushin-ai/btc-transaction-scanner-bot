import { logger } from "@/infrastructure/logger";
import type { AddressActivityFoundEvent } from "@/types/events";

import type { KafkaSinkOptions, NotificationSink, SinkResult } from "./types";

export class KafkaSink implements NotificationSink {
  public readonly kind = "kafka" as const;
  private readonly options: KafkaSinkOptions;

  constructor(options: KafkaSinkOptions) {
    this.options = options;
  }

  async send(_event: AddressActivityFoundEvent): Promise<SinkResult> {
    logger.warn( {
      type: "sink.unavailable",
      sink: this.kind,
      msg: "Kafka sink is a stub; install client and implement producer"
    } );
    return { ok: true };
  }
}


