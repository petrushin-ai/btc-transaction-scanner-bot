import type { Network } from "./Address";
import { btcFromSats, ByteReader, sha256d, toHexLE } from "./ByteReader";
import { decodeScriptPubKey } from "./Script";

export type ParsedTx = {
  txid: string;
  inputs: { prevTxId: string; prevVout: number; scriptSig: string; sequence: number; witness?: string[] }[];
  outputs: { valueBtc: number; scriptPubKeyHex: string; address?: string; scriptType?: string; opReturnDataHex?: string }[];
};

export function parseTransaction(reader: ByteReader, network: Network): ParsedTx {
  const start = reader.position;
  const version = reader.readUInt32LE();
  // segwit marker/flag
  let hasWitness = false;
  const marker = reader.readUInt8();
  const flag = reader.readUInt8();
  let vinCount: number;
  let vinCountStart = 0;
  if (marker === 0x00 && flag === 0x01) {
    hasWitness = true;
    vinCountStart = reader.position;
    vinCount = reader.readVarInt();
  } else {
    // rewind two bytes and read varint for vin count
    reader.rewind(2);
    vinCountStart = reader.position;
    vinCount = reader.readVarInt();
  }

  const inputs = [] as ParsedTx["inputs"];
  for (let i = 0; i < vinCount; i++) {
    const prevHashLE = reader.readSlice(32);
    const prevVout = reader.readUInt32LE();
    const scriptLen = reader.readVarInt();
    const script = reader.readSlice(scriptLen);
    const sequence = reader.readUInt32LE();
    inputs.push({ prevTxId: toHexLE(prevHashLE), prevVout, scriptSig: script.toString("hex"), sequence });
  }

  const voutCount = reader.readVarInt();
  const outputs = [] as ParsedTx["outputs"];
  for (let i = 0; i < voutCount; i++) {
    const valueSats = reader.readUInt64LE();
    const pkScriptLen = reader.readVarInt();
    const pkScript = reader.readSlice(pkScriptLen);
    const decoded = decodeScriptPubKey(pkScript, network);
    outputs.push({
      valueBtc: btcFromSats(valueSats),
      scriptPubKeyHex: pkScript.toString("hex"),
      address: decoded.address,
      scriptType: decoded.type,
      opReturnDataHex: decoded.opReturnDataHex,
    });
  }

  let witnesses: string[][] = [];
  const posBeforeWitness = reader.position;
  if (hasWitness) {
    witnesses = inputs.map(() => [] as string[]);
    for (let i = 0; i < vinCount; i++) {
      const nStack = reader.readVarInt();
      for (let j = 0; j < nStack; j++) {
        const itemLen = reader.readVarInt();
        const item = reader.readSlice(itemLen);
        witnesses[i].push(item.toString("hex"));
      }
    }
  }

  const locktime = reader.readUInt32LE();
  const locktimeStart = reader.position - 4;

  // Compute txid excluding witness per BIP-0141
  const versionBytes = reader.sliceAbsolute(start, start + 4);
  const preWitness = reader.sliceAbsolute(vinCountStart, posBeforeWitness);
  const locktimeBytes = reader.sliceAbsolute(locktimeStart, locktimeStart + 4);
  const nonWitnessSerialization = Buffer.concat([versionBytes, preWitness, locktimeBytes]);
  const txid = toHexLE(sha256d(nonWitnessSerialization));
  // attach witness data
  if (hasWitness) {
    for (let i = 0; i < inputs.length; i++) inputs[i].witness = witnesses[i];
  }

  return { txid, inputs, outputs };
}


