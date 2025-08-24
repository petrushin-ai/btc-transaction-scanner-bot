import type { AddressActivity, ParsedBlock } from "@/types/blockchain";

export type BlockDetectedEvent = {
  type: "BlockDetected";
  timestamp: string;
  height: number;
  hash: string;
};

export type BlockParsedEvent = {
  type: "BlockParsed";
  timestamp: string;
  block: ParsedBlock;
};

export type AddressActivityFoundEvent = {
  type: "AddressActivityFound";
  timestamp: string;
  block: { hash: string; height: number; time: number };
  activity: AddressActivity;
};

export type NotificationEmittedEvent = {
  type: "NotificationEmitted";
  timestamp: string;
  channel: "logger" | "webhook" | "stdout" | "file" | "kafka" | "nats";
  ok: boolean;
  details?: Record<string, unknown>;
};

export type DomainEvent =
  | BlockDetectedEvent
  | BlockParsedEvent
  | AddressActivityFoundEvent
  | NotificationEmittedEvent;

export type DomainEventType = DomainEvent["type"];

export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;


