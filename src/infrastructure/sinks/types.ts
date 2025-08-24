import type { AddressActivityFoundEvent } from "@/types/events";

export type SinkKind = "stdout" | "file" | "webhook" | "kafka" | "nats";

export type SinkResult = { ok: true } | { ok: false; error: Error };

export interface NotificationSink {
  readonly kind: SinkKind;
  send(event: AddressActivityFoundEvent): Promise<SinkResult>;
}

export type StdoutSinkOptions = {
  pretty?: boolean;
};

export type FileSinkOptions = {
  /** Absolute path to file; will be created if missing */
  path: string;
};

export type WebhookSinkOptions = {
  url: string;
  headers?: Record<string, string>;
  /** max retries on 5xx/network errors */
  maxRetries?: number;
  /** backoff in ms function of attempt number starting from 1 */
  backoffMs?: (attempt: number) => number;
};

export type KafkaSinkOptions = {
  brokers: string[];
  topic: string;
};

export type NatsSinkOptions = {
  url: string;
  subject: string;
};


