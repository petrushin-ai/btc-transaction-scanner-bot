import { SEGWIT, SIZES } from "../constants";
import type { Network } from "./Address";
import { btcFromSats, ByteReader, sha256dMany, toHexLE } from "./ByteReader";
import { decodeScriptPubKey } from "./Script";

export type ParsedTx = {
  txid: string;
  inputs: {
    prevTxId: string;
    prevVout: number;
    sequence: number;
    // witness isn't retained to minimize memory
  }[];
  outputs: {
    valueBtc: number;
    address?: string;
    scriptType?: string;
    opReturnDataHex?: string
  }[];
};

export function parseTransaction(reader: ByteReader, network: Network): ParsedTx {
  const start = reader.position;
  // Read version (4 bytes) first per Bitcoin serialization
  /* consume a version to align stream; a version itself isn't retained here */
  reader.readUInt32LE();
  // segwit marker/flag
  let hasWitness = false;
  const marker = reader.readUInt8();
  const flag = reader.readUInt8();
  let vinCount: number;
  let vinCountStart;
  if ( marker === SEGWIT.MARKER && flag === SEGWIT.FLAG ) {
    hasWitness = true;
    vinCountStart = reader.position;
    vinCount = reader.readVarInt();
  } else {
    // rewind two bytes and read varint for vin count
    reader.rewind( 2 );
    vinCountStart = reader.position;
    vinCount = reader.readVarInt();
  }

  const inputs = [] as ParsedTx["inputs"];
  for ( let i = 0; i < vinCount; i++ ) {
    const prevHashLE = reader.readSlice( 32 );
    const prevVout = reader.readUInt32LE();
    const scriptLen = reader.readVarInt();
    // consume scriptSig bytes without converting to hex/materializing a string
    reader.readSlice( scriptLen );
    const sequence = reader.readUInt32LE();
    inputs.push( {
      prevTxId: toHexLE( prevHashLE ),
      prevVout,
      sequence
    } );
  }

  const voutCount = reader.readVarInt();
  const outputs = [] as ParsedTx["outputs"];
  for ( let i = 0; i < voutCount; i++ ) {
    // Use number path for sats for speed; BTC supply fits in 53 bits safely
    const valueSats = reader.readUInt64LEAsNumber();
    const pkScriptLen = reader.readVarInt();
    const pkScript = reader.readSlice( pkScriptLen );
    const decoded = decodeScriptPubKey( pkScript, network );
    outputs.push( {
      valueBtc: btcFromSats( BigInt( valueSats ) ),
      address: decoded.address,
      scriptType: decoded.type,
      opReturnDataHex: decoded.opReturnDataHex,
    } );
  }

  const posBeforeWitness = reader.position;
  if ( hasWitness ) {
    for ( let i = 0; i < vinCount; i++ ) {
      const nStack = reader.readVarInt();
      for ( let j = 0; j < nStack; j++ ) {
        const itemLen = reader.readVarInt();
        // consume bytes without converting to hex strings to reduce allocations
        reader.readSlice( itemLen );
      }
    }
  }

  // Read locktime to advance the reader and compute its byte range
  const locktimeStart = reader.position;
  // Read to consume 4 bytes so the ByteReader ends at the correct position
  // (next transaction), and its bytes are used to compute the txid serialization
  reader.readUInt32LE();

  // Compute txid excluding witness per BIP-0141
  const versionBytes = reader.sliceAbsolute( start, start + SIZES.UINT32 );
  const preWitness = reader.sliceAbsolute( vinCountStart, posBeforeWitness );
  const locktimeBytes = reader.sliceAbsolute( locktimeStart, locktimeStart + SIZES.LOCKTIME );
  const txid = toHexLE( sha256dMany( [ versionBytes, preWitness, locktimeBytes ] ) );
  // witness data omitted intentionally

  return { txid, inputs, outputs };
}


