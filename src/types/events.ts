import type { AddressActivity, ParsedBlock } from "@/types/blockchain";

export type BlockDetectedEvent = {
  type: "BlockDetected";
  timestamp: string;
  height: number;
  hash: string;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
};

export type BlockParsedEvent = {
  type: "BlockParsed";
  timestamp: string;
  block: ParsedBlock;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
};

export type AddressActivityFoundEvent = {
  type: "AddressActivityFound";
  timestamp: string;
  block: { hash: string; height: number; time: number };
  activity: AddressActivity;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
};

export type NotificationEmittedEvent = {
  type: "NotificationEmitted";
  timestamp: string;
  channel: "logger" | "webhook" | "stdout" | "file" | "kafka" | "nats";
  ok: boolean;
  details?: Record<string, unknown>;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
};

export type DomainEvent =
  | BlockDetectedEvent
  | BlockParsedEvent
  | AddressActivityFoundEvent
  | NotificationEmittedEvent;

export type DomainEventType = DomainEvent["type"];

// EventOfType is defined elsewhere or may already exist; not redefining here to avoid duplication.

export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;


