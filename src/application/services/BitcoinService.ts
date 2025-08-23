import { BitcoinRpcClient, Raw } from "@/infrastructure/bitcoin";
import type { HealthResult } from "@/types/healthcheck";
import type {
  AddressActivity,
  BlockchainService,
  ParsedBlock,
  ParsedTransaction,
  WatchedAddress,
} from "../../types/blockchain";

export type BitcoinServiceOptions = {
  pollIntervalMs?: number;
  resolveInputAddresses?: boolean;
  parseRawBlocks?: boolean;
};

export class BitcoinService implements BlockchainService {
  private rpc: BitcoinRpcClient;
  private pollIntervalMs: number;
  private resolveInputAddresses: boolean;
  private parseRawBlocks: boolean;
  private network: Raw.Network = "mainnet";

  constructor(rpc: BitcoinRpcClient, opts?: BitcoinServiceOptions) {
    this.rpc = rpc;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 1000;
    this.resolveInputAddresses = opts?.resolveInputAddresses ?? false;
    this.parseRawBlocks = opts?.parseRawBlocks ?? false;
  }

  async connect(): Promise<void> {
    const info = await this.rpc.getBlockchainInfo();
    // Map chain to network HRP
    const chain = String((info as any).chain || "main");
    if (chain === "main") this.network = "mainnet";
    else if (chain === "test") this.network = "testnet";
    else if (chain === "signet") this.network = "signet";
    else this.network = "regtest";
  }

  async ping(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const info = await this.rpc.getBlockchainInfo();
      const latencyMs = Date.now() - started;
      return {
        provider: "bitcoin-rpc",
        ok: true,
        status: "ok",
        latencyMs,
        checkedAt: new Date().toISOString(),
        details: { chain: info.chain, blocks: info.blocks },
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: "bitcoin-rpc",
        ok: false,
        status: "error",
        latencyMs,
        checkedAt: new Date().toISOString(),
        details: { error: message },
      };
    }
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
    if (!this.parseRawBlocks) {
      const block = (await this.rpc.getBlockByHashVerbose2(blockHash)) as any;
      const parsed: ParsedBlock = {
        hash: block.hash,
        height: block.height,
        time: block.time,
        transactions: await this.parseTransactions(block.tx),
      };
      return parsed;
    }
    // Raw path
    const [hex, header] = await Promise.all([
      this.rpc.getBlockRawByHash(blockHash),
      this.rpc.getBlockHeader(blockHash),
    ]);
    const rawParsed = Raw.parseRawBlock(hex, this.network);
    const parsed: ParsedBlock = {
      hash: rawParsed.hash,
      height: header.height,
      time: header.time,
      transactions: rawParsed.transactions.map((t) => ({
        txid: t.txid,
        inputs: [], // optionally resolved below
        outputs: t.outputs.map((o) => ({
          address: o.address,
          valueBtc: o.valueBtc,
          scriptType: o.scriptType,
          opReturnDataHex: o.opReturnDataHex,
          opReturnUtf8: o.opReturnDataHex ? tryDecodeUtf8(o.opReturnDataHex) : undefined,
        })),
      })),
    };
    // resolve inputs if configured
    if (this.resolveInputAddresses) {
      for (const tx of parsed.transactions) {
        const rawTx = rawParsed.transactions.find((x) => x.txid === tx.txid)!;
        const inputs: { address?: string; valueBtc?: number }[] = [];
        for (const vin of rawTx.inputs) {
          if (vin.prevTxId === "" || vin.prevTxId === "0".repeat(64)) {
            inputs.push({});
            continue;
          }
          try {
            const prev = (await this.rpc.getRawTransactionVerbose(vin.prevTxId)) as any;
            const prevOut = prev.vout?.[vin.prevVout];
            const addresses: string[] | undefined = prevOut?.scriptPubKey?.addresses;
            const addr: string | undefined = Array.isArray(addresses) ? addresses[0] : prevOut?.scriptPubKey?.address;
            inputs.push({ address: addr, valueBtc: prevOut ? Number(prevOut.value) : undefined });
          } catch {
            inputs.push({});
          }
        }
        (tx as any).inputs = inputs;
      }
    }
    return parsed;
  }

  checkTransactions(block: ParsedBlock, watched: WatchedAddress[]): AddressActivity[] {
    const watchSet = new Map<string, string | undefined>();
    for (const w of watched) watchSet.set(w.address, w.label);

    const activities: AddressActivity[] = [];
    for (const tx of block.transactions) {
      // Aggregate in/out per address for this tx
      const incoming = new Map<string, number>();
      const outgoing = new Map<string, number>();

      for (const out of tx.outputs) {
        const addr = out.address;
        if (!addr) continue;
        if (!watchSet.has(addr)) continue;
        incoming.set(addr, (incoming.get(addr) || 0) + out.valueBtc);
      }
      // Only available when resolveInputAddresses is true
      for (const input of tx.inputs) {
        const addr = input.address;
        if (!addr || !input.valueBtc) continue;
        if (!watchSet.has(addr)) continue;
        outgoing.set(addr, (outgoing.get(addr) || 0) + input.valueBtc);
      }

      // Emit net activities per address for this tx
      const addresses = new Set<string>([...incoming.keys(), ...outgoing.keys()]);
      for (const addr of addresses) {
        const inSum = incoming.get(addr) || 0;
        const outSum = outgoing.get(addr) || 0;
        if (inSum > 0 && outSum > 0) {
          const net = inSum - outSum;
          if (Math.abs(net) > 0) {
            activities.push({
              address: addr,
              label: watchSet.get(addr),
              txid: tx.txid,
              direction: net >= 0 ? "in" : "out",
              valueBtc: Math.abs(net),
            });
          }
        } else if (inSum > 0) {
          activities.push({
            address: addr,
            label: watchSet.get(addr),
            txid: tx.txid,
            direction: "in",
            valueBtc: inSum,
          });
        } else if (outSum > 0) {
          activities.push({
            address: addr,
            label: watchSet.get(addr),
            txid: tx.txid,
            direction: "out",
            valueBtc: outSum,
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
        const spk = vout.scriptPubKey || {};
        const addresses: string[] | undefined = spk.addresses;
        const addr: string | undefined = Array.isArray(addresses) ? addresses[0] : spk.address;
        const scriptType: string | undefined = typeof spk.type === "string" ? spk.type : undefined;
        // Extract OP_RETURN data when present via asm pattern
        let opReturnDataHex: string | undefined;
        let opReturnUtf8: string | undefined;
        const asm: string | undefined = typeof spk.asm === "string" ? spk.asm : undefined;
        if (scriptType === "nulldata" && asm) {
          const parts = asm.split(/\s+/);
          const dataHex = parts.length >= 2 && parts[0] === "OP_RETURN" ? parts[1] : undefined;
          if (dataHex && /^[0-9a-fA-F]+$/.test(dataHex)) {
            opReturnDataHex = dataHex.toLowerCase();
            try {
              const bytes = Buffer.from(opReturnDataHex, "hex");
              const text = new TextDecoder().decode(bytes);
              const printable = /[\x09\x0A\x0D\x20-\x7E]/.test(text);
              opReturnUtf8 = printable ? text : undefined;
            } catch {
              // ignore decoding errors
            }
          }
        }
        return {
          address: addr,
          valueBtc: Number(vout.value),
          scriptType,
          opReturnDataHex,
          opReturnUtf8,
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

function tryDecodeUtf8(hex: string): string | undefined {
  try {
    const buf = Buffer.from(hex, "hex");
    const text = new TextDecoder().decode(buf);
    const printable = /[\x09\x0A\x0D\x20-\x7E]/.test(text);
    return printable ? text : undefined;
  } catch {
    return undefined;
  }
}

