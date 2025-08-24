import { createHash } from "crypto";

const HEX_CHARS = "0123456789abcdef";

export class ByteReader {
  private readonly buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  rewind(bytes: number): void {
    const next = this.offset - bytes;
    if (next < 0) throw new Error("rewind before start");
    this.offset = next;
  }

  sliceAbsolute(start: number, end: number): Buffer {
    if (start < 0 || end > this.buffer.length || start > end) throw new Error("sliceAbsolute out of range");
    return this.buffer.subarray(start, end);
  }

  get position(): number {
    return this.offset;
  }

  readSlice(length: number): Buffer {
    if (this.offset + length > this.buffer.length) throw new Error("readSlice out of range");
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readUInt8(): number {
    const v = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUInt32LE(): number {
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readUInt64LE(): bigint {
    // Use BigInt to avoid precision loss; caller can convert if needed
    const lo = BigInt(this.buffer.readUInt32LE(this.offset));
    const hi = BigInt(this.buffer.readUInt32LE(this.offset + 4));
    this.offset += 8;
    return (hi << 32n) | lo;
  }

  /**
   * Read an unsigned 64-bit little-endian integer as a JavaScript number.
   * Safe for Bitcoin amounts (max 2.1e15 < 2^53).
   */
  readUInt64LEAsNumber(): number {
    const lo = this.buffer.readUInt32LE(this.offset);
    const hi = this.buffer.readUInt32LE(this.offset + 4);
    this.offset += 8;
    // Ensure we remain within Number.MAX_SAFE_INTEGER
    // hi must be < 2^21 for the sum to be safe (since (hi << 32) < 2^53)
    if (hi >= 0x200000) {
      // Fallback to bigint path for extremely large values (not expected for BTC amounts)
      const big = (BigInt(hi) << 32n) | BigInt(lo);
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      if (big > maxSafe) throw new Error("uint64 exceeds MAX_SAFE_INTEGER");
      return Number(big);
    }
    return lo + hi * 4294967296; // 2^32
  }

  readVarInt(): number {
    const first = this.readUInt8();
    if (first < 0xfd) return first;
    if (first === 0xfd) return this.readUInt16LE();
    if (first === 0xfe) return this.readUInt32LE();
    const v = this.readUInt64LE();
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (v > maxSafe) throw new Error("varint exceeds MAX_SAFE_INTEGER");
    return Number(v);
  }

  private readUInt16LE(): number {
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
}

export function sha256d(buffer: Buffer): Buffer {
  const h1 = createHash("sha256").update(buffer).digest();
  const h2 = createHash("sha256").update(h1).digest();
  return h2;
}

export function sha256dMany(buffers: Buffer[]): Buffer {
  const h1 = createHash("sha256");
  for (const buf of buffers) h1.update(buf);
  const first = h1.digest();
  const h2 = createHash("sha256").update(first).digest();
  return h2;
}

export function toHexLE(buffer: Buffer): string {
  // Render as big-endian hex of the reversed bytes (for txid/hash display)
  const len = buffer.length;
  let out = "";
  // Reverse order without allocating a copy; append two chars per byte
  for (let i = len - 1; i >= 0; i--) {
    const b = buffer[i];
    out += HEX_CHARS[(b >>> 4) & 0x0f];
    out += HEX_CHARS[b & 0x0f];
  }
  return out;
}

export function btcFromSats(sats: bigint): number {
  // Convert with 1e8; keep double precision (sufficient for logging/reporting)
  const SATS_PER_BTC = 100_000_000n;
  const whole = Number(sats / SATS_PER_BTC);
  const rem = Number(sats % SATS_PER_BTC);
  return whole + rem / 1e8;
}


