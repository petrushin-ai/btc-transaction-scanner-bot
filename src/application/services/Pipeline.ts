import { logActivities, logBlockSummary, logOpReturnData } from "@/application/helpers/bitcoin";
import { getUsdRate, mapActivitiesWithUsd } from "@/application/helpers/currency";
import type { AppConfig } from "@/config";
import { FileSink, KafkaSink, NatsSink, StdoutSink, WebhookSink } from "@/infrastructure/sinks";
import type { NotificationSink } from "@/infrastructure/sinks";
import type { AddressActivity, ParsedBlock } from "@/types/blockchain";
import type { AddressActivityFoundEvent, NotificationEmittedEvent } from "@/types/events";

import type { BitcoinService, CurrencyService, EventService } from ".";
import { WorkersService } from ".";

export function registerEventPipeline(
  events: EventService,
  services: { btc: BitcoinService; currency: CurrencyService },
  cfg: AppConfig,
): void {
  const { btc, currency } = services;
  const workers = new WorkersService(cfg.worker.id, cfg.worker.members);

  // Build sinks from config. Default behavior remains logging to stdout.
  const sinks: NotificationSink[] = [];
  const enabled = cfg.sinks?.enabled || ["stdout"];
  for (const name of enabled) {
    switch (name) {
      case "stdout":
        sinks.push(new StdoutSink(cfg.sinks?.stdout));
        break;
      case "file":
        if (cfg.sinks?.file?.path) sinks.push(new FileSink(cfg.sinks.file));
        break;
      case "webhook":
        if (cfg.sinks?.webhook?.url) sinks.push(new WebhookSink(cfg.sinks.webhook));
        break;
      case "kafka":
        if (cfg.sinks?.kafka) sinks.push(new KafkaSink(cfg.sinks.kafka));
        break;
      case "nats":
        if (cfg.sinks?.nats) sinks.push(new NatsSink(cfg.sinks.nats));
        break;
      default:
        break;
    }
  }

  events.subscribe<"BlockDetected">({
    event: "BlockDetected",
    name: "parse-block",
    concurrency: 1,
    retry: { maxRetries: 3, backoffMs: (n) => Math.min(2000, 100 * n * n) },
    handler: async (ev) => {
      const block: ParsedBlock = await btc.parseBlockByHash(ev.hash);
      const dedupeKey = `BlockParsed:${block.height}:${block.hash}`;
      await events.publish({ type: "BlockParsed", timestamp: new Date().toISOString(), block, dedupeKey });
    },
  });

  events.subscribe<"BlockParsed">({
    event: "BlockParsed",
    name: "compute-activities",
    concurrency: 1,
    retry: { maxRetries: 2, backoffMs: (n) => 100 * n },
    handler: async (ev) => {
      const rate = await getUsdRate(currency);
      const filteredWatch = workers.filterWatched(cfg.watch);
      const activities: AddressActivity[] = mapActivitiesWithUsd(
        btc.checkTransactions(ev.block, filteredWatch),
        rate,
      );
      logBlockSummary(ev.block, activities.length);
      logOpReturnData(ev.block);
      for (const activity of activities) {
        const aev: AddressActivityFoundEvent = {
          type: "AddressActivityFound",
          timestamp: new Date().toISOString(),
          block: { hash: ev.block.hash, height: ev.block.height, time: ev.block.time },
          activity,
          dedupeKey: `AddressActivity:${ev.block.height}:${ev.block.hash}:${activity.address}:${activity.txid}:${activity.direction}`,
        };
        await events.publish(aev);
      }
    },
  });

  events.subscribe<"AddressActivityFound">({
    event: "AddressActivityFound",
    name: "log-activity",
    concurrency: 4,
    retry: { maxRetries: 1, backoffMs: () => 0 },
    handler: async (ev) => {
      logActivities({
        hash: ev.block.hash,
        height: ev.block.height,
        time: ev.block.time,
        transactions: [],
      }, [ev.activity]);
      // Fan out to sinks concurrently with simple error handling
      await Promise.allSettled(sinks.map((s) => s.send(ev)));
      const nev: NotificationEmittedEvent = {
        type: "NotificationEmitted",
        timestamp: new Date().toISOString(),
        channel: sinks.length > 0 ? (sinks[0].kind as any) : "stdout",
        ok: true,
        details: { address: ev.activity.address, txid: ev.activity.txid },
        dedupeKey: `Notification:${ev.block.height}:${ev.block.hash}:${ev.activity.address}:${ev.activity.txid}:${ev.activity.direction}`,
      };
      await events.publish(nev);
    },
  });

  events.subscribe<"NotificationEmitted">({
    event: "NotificationEmitted",
    name: "audit-notification",
    concurrency: 2,
    handler: async (ev) => {
      // no-op; logger subscription happens in index via global logger config
    },
  });
}


