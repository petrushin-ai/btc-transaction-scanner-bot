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
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    };
    // Inline import to avoid top-level cycle concerns
    const {fetchJson, HTTP_METHOD} = await import("@/application/helpers/http");
    const json = await fetchJson<JsonRpcResponse<T>>(this.url, {
      method: HTTP_METHOD.POST,
      headers: {
        "content-type": "application/json",
        ...(this.authHeader ? {authorization: this.authHeader} : {}),
      },
      body,
      timeoutMs: this.timeoutMs,
    });
    if (json.error) {
      throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
    }
    return json.result;
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

  // verbosity = 2 returns transactions with decoded vin/vout but not previous vout addresses
  // unless txindex is enabled for inputs
  getBlockByHashVerbose2(blockHash: string): Promise<unknown> {
    return this.call("getblock", [blockHash, 2]);
  }

  // verbosity = 0 returns the raw serialized block as hex string
  getBlockRawByHash(blockHash: string): Promise<string> {
    return this.call("getblock", [blockHash, 0]);
  }

  // Return the block header (to map hash -> height and time efficiently when parsing raw blocks)
  getBlockHeader(blockHash: string): Promise<{ height: number; time: number }> {
    return this.call("getblockheader", [blockHash, true]);
  }

  // Fetch previous transaction to resolve input addresses; requires -txindex on node
  // for historical lookups
  getRawTransactionVerbose(txid: string): Promise<unknown> {
    return this.call("getrawtransaction", [txid, true]);
  }

  // getBlockchainNetwork(): Promise<{ chain: string }> {
  //   return this.call("getblockchaininfo").then((x: any) => ({chain: String(x.chain)}));
  // }
}

