import type { Network } from "./Address";
import { ByteReader, sha256d, toHexLE } from "./ByteReader";
import { ParsedTx, parseTransaction } from "./TxParser";

export type ParsedRawBlock = {
  hash: string;
  version: number;
  prevBlock: string;
  merkleRoot: string;
  time: number;
  bits: number;
  nonce: number;
  height?: number;
  transactions: ParsedTx[];
};

export function parseRawBlock(hex: string, network: Network): ParsedRawBlock {
  const buffer = Buffer.from( hex, "hex" );
  const reader = new ByteReader( buffer );

  const headerStart = reader.position;
  const version = reader.readUInt32LE();
  const prev = reader.readSlice( 32 );
  const merkle = reader.readSlice( 32 );
  const time = reader.readUInt32LE();
  const bits = reader.readUInt32LE();
  const nonce = reader.readUInt32LE();
  const headerEnd = reader.position;
  const header = buffer.subarray( headerStart, headerEnd );
  const hash = toHexLE( sha256d( header ) );

  const txCount = reader.readVarInt();
  const txs: ParsedTx[] = [];
  for ( let i = 0; i < txCount; i++ ) {
    txs.push( parseTransaction( reader, network ) );
  }

  return {
    hash,
    version,
    prevBlock: toHexLE( prev ),
    merkleRoot: toHexLE( merkle ),
    time,
    bits,
    nonce,
    transactions: txs,
  };
}


