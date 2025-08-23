import { logger } from "@/infrastructure/logger";
import type { AddressActivity, ParsedBlock } from "@/types/blockchain";

export function logBlockSummary(block: ParsedBlock, activityCount: number): void {
  logger.debug({
    type: "block.activities",
    blockHeight: block.height,
    blockHash: block.hash,
    txCount: block.transactions.length,
    activityCount,
  });
}

export function logActivities(block: ParsedBlock, activities: AddressActivity[]): void {
  for (const activity of activities) {
    logger.info({
      type: "transaction.activity",
      blockHeight: block.height,
      blockHash: block.hash,
      txid: activity.txid,
      address: activity.address,
      label: activity.label,
      direction: activity.direction,
      valueBtc: activity.valueBtc,
      valueUsd: activity.valueUsd,
      opReturnHex: activity.opReturnHex,
      opReturnUtf8: activity.opReturnUtf8,
    });
  }
}

export function logOpReturnData(block: ParsedBlock): void {
  for (const tx of block.transactions) {
    for (const output of tx.outputs) {
      if (output.scriptType === "nulldata" && (output.opReturnDataHex || output.opReturnUtf8)) {
        logger.debug({
          type: "transaction.op_return",
          blockHeight: block.height,
          blockHash: block.hash,
          txid: tx.txid,
          opReturnHex: output.opReturnDataHex,
          opReturnUtf8: output.opReturnUtf8,
        });
      }
    }
  }
}


