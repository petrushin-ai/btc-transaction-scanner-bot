import { logActivities, logBlockSummary, logOpReturnData } from "@/application/helpers/bitcoin";
import { getUsdRate, mapActivitiesWithUsd } from "@/application/helpers/currency";
import type { AppConfig } from "@/config";
import type { AddressActivity, ParsedBlock } from "@/types/blockchain";
import type { AddressActivityFoundEvent, NotificationEmittedEvent } from "@/types/events";

import type { BitcoinService, CurrencyService, EventService } from ".";

export function registerEventPipeline(
  events: EventService,
  services: { btc: BitcoinService; currency: CurrencyService },
  cfg: AppConfig,
): void {
  const { btc, currency } = services;

  events.subscribe<"BlockDetected">({
    event: "BlockDetected",
    name: "parse-block",
    concurrency: 1,
    retry: { maxRetries: 3, backoffMs: (n) => Math.min(2000, 100 * n * n) },
    handler: async (ev) => {
      const block: ParsedBlock = await btc.parseBlockByHash(ev.hash);
      await events.publish({ type: "BlockParsed", timestamp: new Date().toISOString(), block });
    },
  });

  events.subscribe<"BlockParsed">({
    event: "BlockParsed",
    name: "compute-activities",
    concurrency: 1,
    retry: { maxRetries: 2, backoffMs: (n) => 100 * n },
    handler: async (ev) => {
      const rate = await getUsdRate(currency);
      const activities: AddressActivity[] = mapActivitiesWithUsd(
        btc.checkTransactions(ev.block, cfg.watch),
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
      const nev: NotificationEmittedEvent = {
        type: "NotificationEmitted",
        timestamp: new Date().toISOString(),
        channel: "logger",
        ok: true,
        details: { address: ev.activity.address, txid: ev.activity.txid },
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


