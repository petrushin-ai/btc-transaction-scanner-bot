export type WatchedAddress = {
  address: string;
  label?: string;
};

export type ParsedTxOutput = {
  address?: string;
  valueBtc: number;
  /*
   * scriptPubKey.type from node
   * (e.g.,
   * pubkeyhash,
   * scripthash,
   * witness_v0_keyhash,
   * witness_v0_scripthash,
   * nulldata,
   * witness_v1_taproot)
   */
  scriptType?: string;
  /** For OP_RETURN (nulldata) outputs: raw hex payload without OP_RETURN opcode */
  opReturnDataHex?: string;
  /** Best-effort UTF-8 decoding of OP_RETURN data */
  opReturnUtf8?: string;
};

export type ParsedTransaction = {
  txid: string;
  inputs: { address?: string; valueBtc?: number }[];
  outputs: ParsedTxOutput[];
};

export type ParsedBlock = {
  hash: string;
  prevHash?: string;
  height: number;
  time: number;
  transactions: ParsedTransaction[];
};

export type AddressActivity = {
  address: string;
  label?: string;
  txid: string;
  direction: "in" | "out";
  valueBtc: number;
  /** Optional precomputed USD equivalent for valueBtc */
  valueUsd?: number;
  /** If the tx includes OP_RETURN outputs, echo best-effort data */
  opReturnHex?: string;
  opReturnUtf8?: string;
};

export interface BlockchainService {
  connect(): Promise<void>;

  awaitNewBlock(sinceHeight?: number): Promise<ParsedBlock>;

  parseBlockByHash(blockHash: string): Promise<ParsedBlock>;

  checkTransactions(block: ParsedBlock, watched: WatchedAddress[]): AddressActivity[];
}

