import { BitcoinRpcClient } from "@/infrastructure/bitcoin";
import type {
  AddressActivity,
  BlockchainService,
  ParsedBlock,
  ParsedTransaction,
  WatchedAddress,
} from "../../domain/blockchain";

export type BitcoinServiceOptions = {
  pollIntervalMs?: number;
  resolveInputAddresses?: boolean;
};

export class BitcoinService implements BlockchainService {
  private rpc: BitcoinRpcClient;
  private pollIntervalMs: number;
  private resolveInputAddresses: boolean;

  constructor(rpc: BitcoinRpcClient, opts?: BitcoinServiceOptions) {
    this.rpc = rpc;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 1000;
    this.resolveInputAddresses = opts?.resolveInputAddresses ?? false;
  }

  async connect(): Promise<void> {
    await this.rpc.getBlockchainInfo();
  }

  async awaitNewBlock(sinceHeight?: number): Promise<ParsedBlock> {
    const startHeight = sinceHeight ?? (await this.rpc.getBlockCount());
    let current: number = startHeight;
    for (;;) {
      await this.sleep(this.pollIntervalMs);
      const latest = await this.rpc.getBlockCount();
      if (latest > current) {
        const hash = await this.rpc.getBlockHash(latest);
        return this.parseBlockByHash(hash);
      }
    }
  }

  async parseBlockByHash(blockHash: string): Promise<ParsedBlock> {
    const block = (await this.rpc.getBlockByHashVerbose2(blockHash)) as any;
    const parsed: ParsedBlock = {
      hash: block.hash,
      height: block.height,
      time: block.time,
      transactions: await this.parseTransactions(block.tx),
    };
    return parsed;
  }

  checkTransactions(block: ParsedBlock, watched: WatchedAddress[]): AddressActivity[] {
    const watchSet = new Map<string, string | undefined>();
    for (const w of watched) watchSet.set(w.address, w.label);

    const activities: AddressActivity[] = [];
    for (const tx of block.transactions) {
      for (const out of tx.outputs) {
        if (out.address && watchSet.has(out.address)) {
          activities.push({
            address: out.address,
            label: watchSet.get(out.address),
            txid: tx.txid,
            direction: "in",
            valueBtc: out.valueBtc,
          });
        }
      }
      for (const input of tx.inputs) {
        if (input.address && watchSet.has(input.address) && input.valueBtc) {
          activities.push({
            address: input.address,
            label: watchSet.get(input.address),
            txid: tx.txid,
            direction: "out",
            valueBtc: input.valueBtc,
          });
        }
      }
    }
    return activities;
  }

  private async parseTransactions(rawTxs: any[]): Promise<ParsedTransaction[]> {
    const parsed: ParsedTransaction[] = [];
    for (const tx of rawTxs) {
      const outputs = (tx.vout as any[]).map((vout) => {
        const addresses: string[] | undefined = vout.scriptPubKey?.addresses;
        const addr: string | undefined = Array.isArray(addresses) ? addresses[0] : vout.scriptPubKey?.address;
        return {
          address: addr,
          valueBtc: Number(vout.value),
        };
      });

      const inputs: { address?: string; valueBtc?: number }[] = [];
      if (this.resolveInputAddresses) {
        for (const vin of tx.vin as any[]) {
          if (vin.coinbase) {
            inputs.push({});
            continue;
          }
          if (vin.txid === undefined || vin.vout === undefined) {
            inputs.push({});
            continue;
          }
          try {
            const prev = (await this.rpc.getRawTransactionVerbose(vin.txid)) as any;
            const prevOut = prev.vout?.[vin.vout];
            const addresses: string[] | undefined = prevOut?.scriptPubKey?.addresses;
            const addr: string | undefined = Array.isArray(addresses) ? addresses[0] : prevOut?.scriptPubKey?.address;
            inputs.push({ address: addr, valueBtc: prevOut ? Number(prevOut.value) : undefined });
          } catch {
            inputs.push({});
          }
        }
      }

      parsed.push({
        txid: tx.txid,
        inputs,
        outputs,
      });
    }
    return parsed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

