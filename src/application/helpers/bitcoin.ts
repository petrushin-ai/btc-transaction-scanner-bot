import type { Network } from "@/infrastructure/bitcoin/raw/Address";
import { validateAndNormalizeAddress } from "@/infrastructure/bitcoin/raw/Address";
import { logger } from "@/infrastructure/logger";
import type { AddressActivity, ParsedBlock } from "@/types/blockchain";

// OP_RETURN safe logging policy
const OP_RETURN_MAX_LOG_BYTES = 80; // cap to 80 bytes (standard OP_RETURN max)
const OP_RETURN_MAX_LOG_HEX_CHARS = OP_RETURN_MAX_LOG_BYTES * 2;
const OP_RETURN_MAX_LOG_UTF8_CHARS = OP_RETURN_MAX_LOG_BYTES; // conservative cap

function sanitizeOpReturnForLog(hex?: string, utf8?: string): {
  opReturnHex?: string;
  opReturnUtf8?: string;
  opReturnBytes?: number;
  opReturnRedacted?: boolean;
} {
  if (!hex && !utf8) return {};

  let bytesLen = 0;
  if (hex && /^[0-9a-fA-F]+$/.test(hex)) {
    bytesLen = Math.floor(hex.length / 2);
  }

  // Determine redaction based on byte size
  const shouldRedact = bytesLen > OP_RETURN_MAX_LOG_BYTES;

  // Prepare hex value (truncate if needed)
  let outHex: string | undefined = undefined;
  if (hex) {
    outHex = hex.length > OP_RETURN_MAX_LOG_HEX_CHARS ? hex.slice(0, OP_RETURN_MAX_LOG_HEX_CHARS) : hex;
  }

  // UTF-8 detection: prefer provided utf8 when present and printable; otherwise try decode from hex
  let outUtf8: string | undefined = undefined;
  const printableRegex = /^[\x09\x0A\x0D\x20-\x7E]+$/;
  const tryTruncateUtf8 = (s: string): string => (s.length > OP_RETURN_MAX_LOG_UTF8_CHARS ? s.slice(0, OP_RETURN_MAX_LOG_UTF8_CHARS) : s);

  if (utf8 && printableRegex.test(utf8)) {
    outUtf8 = tryTruncateUtf8(utf8);
  } else if (!utf8 && hex && /^[0-9a-fA-F]+$/.test(hex)) {
    try {
      const buf = Buffer.from(hex, "hex");
      const text = new TextDecoder().decode(buf);
      if (printableRegex.test(text)) {
        outUtf8 = tryTruncateUtf8(text);
      }
    } catch {
      // ignore decoding errors
    }
  }

  return {
    opReturnHex: outHex,
    opReturnUtf8: outUtf8,
    opReturnBytes: bytesLen || undefined,
    opReturnRedacted: shouldRedact || (outHex ? outHex.length < (hex?.length || 0) : false) || (outUtf8 ? outUtf8.length < (utf8?.length || 0) : false) || undefined,
  };
}

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
    const safe = sanitizeOpReturnForLog(activity.opReturnHex, activity.opReturnUtf8);
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
      opReturnHex: safe.opReturnHex,
      opReturnUtf8: safe.opReturnUtf8,
      opReturnBytes: safe.opReturnBytes,
      opReturnRedacted: safe.opReturnRedacted,
    });
  }
}

export function logOpReturnData(block: ParsedBlock): void {
  for (const tx of block.transactions) {
    for (const output of tx.outputs) {
      if (output.scriptType === "nulldata" && (output.opReturnDataHex || output.opReturnUtf8)) {
        const safe = sanitizeOpReturnForLog(output.opReturnDataHex, output.opReturnUtf8);
        logger.debug({
          type: "transaction.op_return",
          blockHeight: block.height,
          blockHash: block.hash,
          txid: tx.txid,
          opReturnHex: safe.opReturnHex,
          opReturnUtf8: safe.opReturnUtf8,
          opReturnBytes: safe.opReturnBytes,
          opReturnRedacted: safe.opReturnRedacted,
        });
      }
    }
  }
}


export function normalizeWatchedAddresses(
  list: { address: string; label?: string }[],
  network?: Network
): { address: string; label?: string }[] {
  const out: { address: string; label?: string }[] = [];
  for (const item of list) {
    const addr = (item.address || "").trim();
    if (!addr) continue;
    const { normalized } = validateAndNormalizeAddress(addr, network);
    out.push({ address: normalized, label: item.label });
  }
  return out;
}

