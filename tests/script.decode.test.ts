import { describe, expect, test } from "bun:test";

import type { Network } from "@/infrastructure/bitcoin/raw/Address";
import { decodeScriptPubKey } from "@/infrastructure/bitcoin/raw/Script";

function hexToBuf(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

describe("Script decoding and address formats", () => {
  const network: Network = "mainnet";

  test("P2PKH -> type pubkeyhash, address starts with 1", () => {
    // OP_DUP OP_HASH160 PUSH20 <20> OP_EQUALVERIFY OP_CHECKSIG
    const hash160 = Buffer.alloc(20, 0x11);
    const script = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      hash160,
      Buffer.from([0x88, 0xac]),
    ]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("pubkeyhash");
    expect(typeof decoded.address).toBe("string");
    expect(decoded.address!.startsWith("1")).toBe(true);
  });

  test("P2SH -> type scripthash, address starts with 3", () => {
    // OP_HASH160 PUSH20 <20> OP_EQUAL
    const hash160 = Buffer.alloc(20, 0x22);
    const script = Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      hash160,
      Buffer.from([0x87]),
    ]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("scripthash");
    expect(typeof decoded.address).toBe("string");
    expect(decoded.address!.startsWith("3")).toBe(true);
  });

  test("P2WPKH -> type witness_v0_keyhash, address starts with bc1q", () => {
    // 0x00 PUSH20 <20>
    const prog = Buffer.alloc(20, 0x33);
    const script = Buffer.concat([Buffer.from([0x00, 0x14]), prog]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("witness_v0_keyhash");
    expect(typeof decoded.address).toBe("string");
    expect(decoded.address!.startsWith("bc1q")).toBe(true);
  });

  test("P2WSH -> type witness_v0_scripthash, address starts with bc1q", () => {
    // 0x00 PUSH32 <32>
    const prog = Buffer.alloc(32, 0x44);
    const script = Buffer.concat([Buffer.from([0x00, 0x20]), prog]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("witness_v0_scripthash");
    expect(typeof decoded.address).toBe("string");
    expect(decoded.address!.startsWith("bc1q")).toBe(true);
  });

  test("Taproot -> type witness_v1_taproot, address starts with bc1p", () => {
    // OP_1 PUSH32 <32>
    const prog = Buffer.alloc(32, 0x55);
    const script = Buffer.concat([Buffer.from([0x51, 0x20]), prog]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("witness_v1_taproot");
    expect(typeof decoded.address).toBe("string");
    expect(decoded.address!.startsWith("bc1p")).toBe(true);
  });

  test("OP_RETURN -> type nulldata with payload hex", () => {
    // OP_RETURN PUSH(4) 'test' (74657374)
    const payload = hexToBuf("74657374");
    const script = Buffer.concat([Buffer.from([0x6a, payload.length]), payload]);
    const decoded = decodeScriptPubKey(script, network);
    expect(decoded.type).toBe("nulldata");
    expect(decoded.opReturnDataHex).toBe("74657374");
  });
});


