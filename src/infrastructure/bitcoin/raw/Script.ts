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
  const versions = getAddressVersionsForNetwork( network );
  // OP_RETURN pattern: 0x6a [pushdata]
  if ( script.length >= 1 && script[0] === OP.RETURN ) {
    // Extract the first data payload that follows OP_RETURN; skip over non-push opcodes
    let i = 1;
    let payload: Buffer | undefined = undefined;
    while ( i < script.length ) {
      const opcode = script[i];
      // Any of the push opcodes or small push lengths (<= 0x4b) indicate a pushdata sequence
      if (
        opcode <= 0x4b
        || opcode === OP.PUSHDATA1
        || opcode === OP.PUSHDATA2
        || opcode === OP.PUSHDATA4
      ) {
        payload = decodePushAt( script, i );
        break;
      }
      // Skip single-byte opcodes (including OP_0..OP_16) to locate the first pushdata
      i += 1;
    }
    // Only classify as nulldata when there is a non-empty payload present
    if ( payload && payload.length > 0 ) {
      return { type: "nulldata", opReturnDataHex: payload.toString( "hex" ) };
    }
    // If no payload (or zero-length), treat as nonstandard for extraction purposes
    return { type: "nonstandard" };
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
    const hash160 = script.subarray( 3, 23 );
    const address = base58checkEncode( versions.p2pkh, hash160 );
    return { type: "pubkeyhash", address };
  }
  // P2SH: OP_HASH160 0x14 <20> OP_EQUAL
  if (
    script.length === SCRIPT_LENGTHS.P2SH &&
    script[0] === OP.HASH160 &&
    script[1] === PUSH.BYTES_20 &&
    script[22] === OP.EQUAL
  ) {
    const hash160 = script.subarray( 2, 22 );
    const address = base58checkEncode( versions.p2sh, hash160 );
    return { type: "scripthash", address };
  }
  // SegWit v0: 0x00 0x14 (keyhash) or 0x00 0x20 (scripthash)
  if (
    script.length >= 2
    && script[0] === OP.OP_0
    && (
      script[1] === PUSH.BYTES_20
      || script[1] === PUSH.BYTES_32
    )
  ) {
    const prog = script.subarray( 2 );
    if ( script[1] === PUSH.BYTES_20 ) {
      const address = encodeWitnessAddress( versions.hrp, SEGWIT.V0, prog );
      return { type: "witness_v0_keyhash", address };
    } else {
      const address = encodeWitnessAddress( versions.hrp, SEGWIT.V0, prog );
      return { type: "witness_v0_scripthash", address };
    }
  }
  // Taproot (v1): 0x51 0x20 <32-byte>
  if (
    script.length === SCRIPT_LENGTHS.TAPROOT
    && script[0] === OP.OP_1
    && script[1] === PUSH.BYTES_32
  ) {
    const prog = script.subarray( 2 );
    const address = encodeWitnessAddress( versions.hrp, SEGWIT.V1, prog );
    return { type: "witness_v1_taproot", address };
  }
  return { type: "nonstandard" };
}

function decodePushAt(script: Buffer, index: number): Buffer | undefined {
  if ( index >= script.length ) return undefined;
  const opcode = script[index];
  if ( opcode <= 0x4b ) {
    const len = opcode;
    const start = index + 1;
    const end = start + len;
    if ( end > script.length ) return undefined;
    return script.subarray( start, end );
  }
  if ( opcode === OP.PUSHDATA1 ) {
    if ( index + 1 >= script.length ) return undefined;
    const len = script[index + 1];
    const start = index + 2;
    const end = start + len;
    if ( end > script.length ) return undefined;
    return script.subarray( start, end );
  }
  if ( opcode === OP.PUSHDATA2 ) {
    if ( index + 3 > script.length ) return undefined; // need 2 bytes for length
    const len = script.readUInt16LE( index + 1 );
    const start = index + 3;
    const end = start + len;
    if ( end > script.length ) return undefined;
    return script.subarray( start, end );
  }
  if ( opcode === OP.PUSHDATA4 ) {
    if ( index + 5 > script.length ) return undefined; // need 4 bytes for length
    const len = script.readUInt32LE( index + 1 );
    const start = index + 5;
    const end = start + len;
    if ( end > script.length ) return undefined;
    return script.subarray( start, end );
  }
  return undefined;
}


