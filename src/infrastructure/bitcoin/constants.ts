// Bitcoin infrastructure shared constants

// Units
export const SATS_PER_BTC_BIGINT = 100_000_000n;
export const SATS_PER_BTC = 100_000_000;

// Sizes (bytes)
export const SIZES = {
  UINT16: 2,
  UINT32: 4,
  UINT64: 8,
  HASH32: 32,
  LOCKTIME: 4,
} as const;

// Numeric thresholds
export const TWO_POW_32 = 4_294_967_296; // 2^32 for number math
export const NUMBER_UINT64_HIGH_SAFE_LIMIT = 0x200000; // hi < 2^21 to keep (hi<<32) < 2^53

// VarInt markers (compactSize)
export const VARINT_MARKER = {
  UINT16: 0xfd,
  UINT32: 0xfe,
  UINT64: 0xff,
} as const;

// Script opcodes and push markers used in this project
export const OP = {
  OP_0: 0x00,
  OP_1: 0x51,
  DUP: 0x76,
  HASH160: 0xa9,
  EQUAL: 0x87,
  EQUALVERIFY: 0x88,
  CHECKSIG: 0xac,
  RETURN: 0x6a,
  PUSHDATA1: 0x4c,
  PUSHDATA2: 0x4d,
  PUSHDATA4: 0x4e,
} as const;

export const PUSH = {
  BYTES_20: 0x14,
  BYTES_32: 0x20,
} as const;

export const SCRIPT_LENGTHS = {
  P2PKH: 25,
  P2SH: 23,
  TAPROOT: 34,
  P2WPKH_REDEEM: 22,
  P2WSH_REDEEM: 34,
} as const;

// SegWit markers/versions
export const SEGWIT = {
  MARKER: 0x00,
  FLAG: 0x01,
  V0: 0,
  V1: 1,
} as const;

// Bech32/Bech32m
export const BECH32 = {
  CHARSET: "qpzry9x8gf2tvdw0s3jn54khce6mua7l",
  // Polymod generators
  GENERATORS: [ 0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3 ],
  CONST_BECH32: 1,
  CONST_BECH32M: 0x2bc830a3,
} as const;

// Base58 alphabet
export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Network versions / HRP
export type Network = "mainnet" | "testnet" | "signet" | "regtest";

export const NETWORKS: Record<Network, { p2pkh: number; p2sh: number; hrp: string }> = {
  mainnet: { p2pkh: 0x00, p2sh: 0x05, hrp: "bc" },
  testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "tb" },
  signet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "tb" },
  regtest: { p2pkh: 0x6f, p2sh: 0xc4, hrp: "bcrt" },
};

// Common string constants
export const NULL_TXID_64 = "0".repeat(64);

// Service defaults
export const PREV_TX_CACHE_MAX_DEFAULT = 1000;
export const POLL_INTERVAL_MS_DEFAULT = 1000;


