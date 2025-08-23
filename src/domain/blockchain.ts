export type WatchedAddress = {
  address: string;
  label?: string;
};

export type ParsedTxOutput = {
  address?: string;
  valueBtc: number;
};

export type ParsedTransaction = {
  txid: string;
  inputs: { address?: string; valueBtc?: number }[];
  outputs: ParsedTxOutput[];
};

export type ParsedBlock = {
  hash: string;
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
};

export interface BlockchainService {
  connect(): Promise<void>;
  awaitNewBlock(sinceHeight?: number): Promise<ParsedBlock>;
  parseBlockByHash(blockHash: string): Promise<ParsedBlock>;
  checkTransactions(block: ParsedBlock, watched: WatchedAddress[]): AddressActivity[];
}

