type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown[];
};

type JsonRpcResponse<T> = {
  result: T;
  error?: { code: number; message: string } | null;
  id: number;
};

export type BitcoinRpcClientOptions = {
  url: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
};

export class BitcoinRpcClient {
  private url: string;
  private authHeader?: string;
  private timeoutMs: number;
  private nextId: number = 1;

  constructor(opts: BitcoinRpcClientOptions) {
    this.url = opts.url;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    if (opts.username && opts.password) {
      const encoded = Buffer.from(`${opts.username}:${opts.password}`).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      };
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.authHeader ? { authorization: this.authHeader } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`RPC HTTP ${response.status}: ${await response.text()}`);
      }
      const json = (await response.json()) as JsonRpcResponse<T>;
      if (json.error) {
        throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
      }
      return json.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  getBlockchainInfo(): Promise<{ chain: string; blocks: number }> {
    return this.call("getblockchaininfo");
  }

  getBlockCount(): Promise<number> {
    return this.call("getblockcount");
  }

  getBlockHash(height: number): Promise<string> {
    return this.call("getblockhash", [height]);
  }

  // verbosity = 2 returns transactions with decoded vin/vout but not previous vout addresses unless txindex is enabled for inputs
  getBlockByHashVerbose2(blockHash: string): Promise<unknown> {
    return this.call("getblock", [blockHash, 2]);
  }

  // Fetch previous transaction to resolve input addresses; requires -txindex on node for historical lookups
  getRawTransactionVerbose(txid: string): Promise<unknown> {
    return this.call("getrawtransaction", [txid, true]);
  }
}

