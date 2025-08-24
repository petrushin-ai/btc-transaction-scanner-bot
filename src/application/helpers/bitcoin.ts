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

// Lightweight Bloom filter for address membership checks
// Uses double hashing with two 32-bit hashes and k functions: h_i(x) = h1 + i*h2 mod m
export type AddressBloomFilter = {
  readonly sizeBits: number;
  readonly numHashFunctions: number;
  mightContain(value: string): boolean;
};

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function djb2_32(str: string): number {
  let hash = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // hash * 33 + c
  }
  return hash >>> 0;
}

export function createAddressBloomFilter(addresses: string[], falsePositiveRate: number = 0.01): AddressBloomFilter | undefined {
  const n = addresses.length >>> 0;
  if (!n) return undefined;
  const p = Math.min(Math.max(falsePositiveRate, 1e-6), 0.5);
  const ln2 = Math.log(2);
  const mFloat = Math.ceil(-(n * Math.log(p)) / (ln2 * ln2));
  const m = Math.max(64, mFloat); // at least 64 bits
  const k = Math.max(1, Math.round((m / n) * ln2));

  const numWords = Math.ceil(m / 32);
  const bits = new Uint32Array(numWords);

  const setBit = (idx: number) => {
    const word = (idx / 32) | 0;
    const bit = idx % 32;
    bits[word] |= (1 << bit) >>> 0;
  };

  const indexFor = (s: string, i: number): number => {
    // double hashing: (h1 + i*h2) % m; ensure non-zero h2
    const h1 = fnv1a32(s);
    let h2 = djb2_32(s);
    if (h2 === 0) h2 = 0x27d4eb2d; // avalanche constant if djb2 returns 0
    const x = (h1 + Math.imul(i, h2)) >>> 0;
    return x % m;
  };

  for (const a of addresses) {
    for (let i = 0; i < k; i++) {
      setBit(indexFor(a, i));
    }
  }

  const testBit = (idx: number) => {
    const word = (idx / 32) | 0;
    const bit = idx % 32;
    return (bits[word] & ((1 << bit) >>> 0)) !== 0;
  };

  return {
    sizeBits: m,
    numHashFunctions: k,
    mightContain(value: string): boolean {
      for (let i = 0; i < k; i++) {
        if (!testBit(indexFor(value, i))) return false;
      }
      return true;
    },
  };
}

