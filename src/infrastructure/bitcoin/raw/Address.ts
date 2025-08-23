import { createHash } from "crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type Network = "mainnet" | "testnet" | "signet" | "regtest";

export function base58checkEncode(version: number, payload: Buffer): string {
  const data = Buffer.concat([Buffer.from([version]), payload]);
  const checksum = sha256d(data).subarray(0, 4);
  const full = Buffer.concat([data, checksum]);
  return base58Encode(full);
}

function base58Encode(buffer: Buffer): string {
  let x = BigInt("0x" + buffer.toString("hex"));
  const base = 58n;
  let s = "";
  while (x > 0n) {
    const mod = Number(x % base);
    s = BASE58_ALPHABET[mod] + s;
    x = x / base;
  }
  // preserve leading zero bytes as '1'
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) s = "1" + s;
  return s || "1";
}

export function sha256d(buf: Buffer): Buffer {
  const h1 = createHash("sha256").update(buf).digest();
  const h2 = createHash("sha256").update(h1).digest();
  return h2;
}

// bech32/bech32m encoding (BIP-0173/0350) minimal implementation

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      chk ^= ((top >> i) & 1) ? GENERATORS[i] : 0;
    }
  }
  return chk >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32CreateChecksum(hrp: string, data: number[], spec: "bech32" | "bech32m"): number[] {
  const constVal = spec === "bech32" ? 1 : 0x2bc830a3;
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ constVal;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) ret.push((mod >> (5 * (5 - p))) & 31);
  return ret;
}

function bech32Encode(hrp: string, data: number[], spec: "bech32" | "bech32m"): string {
  const checksum = bech32CreateChecksum(hrp, data, spec);
  const combined = [...data, ...checksum];
  let out = hrp + "1";
  for (const c of combined) out += BECH32_CHARSET[c];
  return out;
}

// Convert 8-bit to 5-bit groups
function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  for (const value of data) {
    if (value < 0 || (value >> from) !== 0) return [];
    acc = ((acc << from) | value) & maxAcc;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return [];
  }
  return ret;
}

export function encodeWitnessAddress(hrp: string, witnessVersion: number, witnessProgram: Buffer): string {
  const spec = witnessVersion === 0 ? "bech32" : "bech32m";
  const data: number[] = [witnessVersion];
  const prog5 = convertBits(witnessProgram, 8, 5, true);
  return bech32Encode(hrp, [...data, ...prog5], spec);
}

export function getAddressVersionsForNetwork(network: Network): { p2pkh: number; p2sh: number; hrp: string } {
  switch (network) {
    case "mainnet":
      return { p2pkh: 0x00, p2sh: 0x05, hrp: "bc" };
    case "testnet":
    case "signet":
      return { p2pkh: 0x6f, p2sh: 0xc4, hrp: "tb" };
    case "regtest":
      return { p2pkh: 0x6f, p2sh: 0xc4, hrp: "bcrt" };
  }
}


