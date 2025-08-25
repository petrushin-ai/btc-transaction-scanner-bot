import type { AddressActivity, ParsedBlock } from "@/types/blockchain";

export type BlockDetectedEvent = {
  type: "BlockDetected";
  timestamp: string;
  height: number;
  hash: string;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
  /** Canonical deterministic event id to prefer for idempotency */
  eventId?: string;
};

export type BlockParsedEvent = {
  type: "BlockParsed";
  timestamp: string;
  block: ParsedBlock;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
  /** Canonical deterministic event id to prefer for idempotency */
  eventId?: string;
};

export type AddressActivityFoundEvent = {
  type: "AddressActivityFound";
  timestamp: string;
  block: { hash: string; height: number; time: number };
  activity: AddressActivity;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
  /** Canonical deterministic event id to prefer for idempotency */
  eventId?: string;
};

export type NotificationEmittedEvent = {
  type: "NotificationEmitted";
  timestamp: string;
  channel: "logger" | "webhook" | "stdout" | "file" | "kafka" | "nats";
  ok: boolean;
  details?: Record<string, unknown>;
  /** Deterministic key to enable at-least-once deduplication downstream */
  dedupeKey?: string;
  /** Canonical deterministic event id to prefer for idempotency */
  eventId?: string;
};

export type BlockReorgEvent = {
  type: "BlockReorg";
  timestamp: string;
  /** Height that changed due to reorg */
  height: number;
  /** The block hash that was previously at this height */
  oldHash: string;
  /** The block hash that replaced it */
  newHash: string;
  /** Deterministic id for idempotency */
  eventId?: string;
  dedupeKey?: string;
};

export type DomainEvent =
  | BlockDetectedEvent
  | BlockParsedEvent
  | AddressActivityFoundEvent
  | NotificationEmittedEvent
  | BlockReorgEvent;

export type DomainEventType = DomainEvent["type"];

// EventOfType is defined elsewhere or may already exist; not redefining here to avoid duplication.

export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;


