import { OP, PUSH, SCRIPT_LENGTHS, SEGWIT } from "../constants";
import {
  base58checkEncode,
  encodeWitnessAddress,
  getAddressVersionsForNetwork,
  Network
} from "./Address";

export type ScriptType =
  | "pubkeyhash" // P2PKH
  | "scripthash" // P2SH
  | "witness_v0_keyhash" // P2WPKH
  | "witness_v0_scripthash" // P2WSH
  | "witness_v1_taproot" // P2TR
  | "nulldata" // OP_RETURN
  | "nonstandard";

export type DecodedScript = {
  type: ScriptType;
  address?: string;
  opReturnDataHex?: string;
};

export function decodeScriptPubKey(script: Buffer, network: Network): DecodedScript {
  const versions = getAddressVersionsForNetwork(network);
  // OP_RETURN pattern: 0x6a [pushdata]
  if (script.length >= 1 && script[0] === OP.RETURN) {
    // Extract data payload if present
    const payload = decodePushAt(script, 1);
    return { type: "nulldata", opReturnDataHex: payload?.toString("hex") };
  }
  // P2PKH: OP_DUP OP_HASH160 0x14 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
  if (
    script.length === SCRIPT_LENGTHS.P2PKH &&
    script[0] === OP.DUP &&
    script[1] === OP.HASH160 &&
    script[2] === PUSH.BYTES_20 &&
    script[23] === OP.EQUALVERIFY &&
    script[24] === OP.CHECKSIG
  ) {
    const hash160 = script.subarray(3, 23);
    const address = base58checkEncode(versions.p2pkh, hash160);
    return { type: "pubkeyhash", address };
  }
  // P2SH: OP_HASH160 0x14 <20> OP_EQUAL
  if (
    script.length === SCRIPT_LENGTHS.P2SH &&
    script[0] === OP.HASH160 &&
    script[1] === PUSH.BYTES_20 &&
    script[22] === OP.EQUAL
  ) {
    const hash160 = script.subarray(2, 22);
    const address = base58checkEncode(versions.p2sh, hash160);
    return { type: "scripthash", address };
  }
  // SegWit v0: 0x00 0x14 (keyhash) or 0x00 0x20 (scripthash)
  if (script.length >= 2 && script[0] === OP.OP_0 && (script[1] === PUSH.BYTES_20 || script[1] === PUSH.BYTES_32)) {
    const prog = script.subarray(2);
    if (script[1] === PUSH.BYTES_20) {
      const address = encodeWitnessAddress(versions.hrp, SEGWIT.V0, prog);
      return { type: "witness_v0_keyhash", address };
    } else {
      const address = encodeWitnessAddress(versions.hrp, SEGWIT.V0, prog);
      return { type: "witness_v0_scripthash", address };
    }
  }
  // Taproot (v1): 0x51 0x20 <32-byte>
  if (script.length === SCRIPT_LENGTHS.TAPROOT && script[0] === OP.OP_1 && script[1] === PUSH.BYTES_32) {
    const prog = script.subarray(2);
    const address = encodeWitnessAddress(versions.hrp, SEGWIT.V1, prog);
    return { type: "witness_v1_taproot", address };
  }
  return { type: "nonstandard" };
}

function decodePushAt(script: Buffer, index: number): Buffer | undefined {
  if (index >= script.length) return undefined;
  const opcode = script[index];
  if (opcode <= 0x4b) {
    const len = opcode;
    const start = index + 1;
    const end = start + len;
    if (end > script.length) return undefined;
    return script.subarray(start, end);
  }
  if (opcode === OP.PUSHDATA1) {
    if (index + 1 >= script.length) return undefined;
    const len = script[index + 1];
    const start = index + 2;
    const end = start + len;
    if (end > script.length) return undefined;
    return script.subarray(start, end);
  }
  if (opcode === OP.PUSHDATA2) {
    if (index + 3 > script.length) return undefined; // need 2 bytes for length
    const len = script.readUInt16LE(index + 1);
    const start = index + 3;
    const end = start + len;
    if (end > script.length) return undefined;
    return script.subarray(start, end);
  }
  if (opcode === OP.PUSHDATA4) {
    if (index + 5 > script.length) return undefined; // need 4 bytes for length
    const len = script.readUInt32LE(index + 1);
    const start = index + 5;
    const end = start + len;
    if (end > script.length) return undefined;
    return script.subarray(start, end);
  }
  return undefined;
}

// Redeem script classifiers (for inputs): detect nested SegWit (P2SH-P2WPKH/P2WSH)
export type RedeemScriptType = "p2wpkh" | "p2wsh" | "unknown";

export function classifyRedeemScript(script: Buffer): RedeemScriptType {
  // P2WPKH redeem: 0x00 0x14 <20>
  if (script.length === SCRIPT_LENGTHS.P2WPKH_REDEEM && script[0] === OP.OP_0 && script[1] === PUSH.BYTES_20) return "p2wpkh";
  // P2WSH redeem: 0x00 0x20 <32>
  if (script.length === SCRIPT_LENGTHS.P2WSH_REDEEM && script[0] === OP.OP_0 && script[1] === PUSH.BYTES_32) return "p2wsh";
  return "unknown";
}

// Taproot witness basics: classify key-path vs script-path using witness stack layout
// witness is an array of stack items as Buffers, in order they appear on wire
export type TaprootWitnessKind = "keypath" | "scriptpath" | "unknown";

export function classifyTaprootWitnessBasic(witness: Buffer[]): TaprootWitnessKind {
  if (!Array.isArray(witness) || witness.length === 0) return "unknown";
  // Script path should include a control block as the last stack element (per BIP341)
  // where control block length is 33 + 32*m with first byte having bit 0 indicating parity and top bits encoding leaf version.
  // Minimal check: last element length >= 33 and first byte & 0x80 is set (0xc0 typical for tapscript v0xc0)
  const last = witness[witness.length - 1];
  if (last && last.length >= 33) {
    const b0 = last[0];
    const isControlBlock = (b0 & 0x80) === 0x80; // high bit set for BIP341 control blocks
    if (isControlBlock) return "scriptpath";
  }
  // Key path typically has a single 64/65-byte Schnorr signature (with optional annex ignored)
  if (witness.length === 1 && (witness[0].length === 64 || witness[0].length === 65)) return "keypath";
  return "unknown";
}


