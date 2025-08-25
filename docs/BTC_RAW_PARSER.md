## Bitcoin Raw Block & Transaction Parser

This document describes the design and implementation details of our raw Bitcoin block/transaction parsing pipeline. It covers binary structures, supported script types and address derivation, network handling, and how the parser integrates with the app.

### Goals

- Directly parse raw blocks from `getblock(hash, 0)` per project requirements.
- Support legacy and SegWit transactions, including witness data.
- Derive addresses for common script types: P2PKH, P2SH, P2WPKH, P2WSH, Taproot.
- Extract OP_RETURN payloads and provide best-effort UTF-8 decoding.
- Keep memory footprint low and parsing fast.

### Modules

- `src/infrastructure/bitcoin/raw/ByteReader.ts`
  - Minimal buffered reader for little-endian integers, varints, slices.
  - Helpers: `sha256d`, `toHexLE`, `btcFromSats`, `rewind`, `sliceAbsolute`.

- `src/infrastructure/bitcoin/raw/Address.ts`
  - Base58Check encoder for legacy (P2PKH/P2SH).
  - Bech32/Bech32m encoder (BIP-0173/0350) for SegWit (v0, v1).
  - Network mapping to version bytes and HRP: mainnet, testnet/signet, regtest.

- `src/infrastructure/bitcoin/raw/Script.ts`
  - Detects script types and derives destination addresses where applicable.
  - Supported types:
    - `pubkeyhash` (P2PKH): `OP_DUP OP_HASH160 PUSH20 <hash160> OP_EQUALVERIFY OP_CHECKSIG`
    - `scripthash` (P2SH): `OP_HASH160 PUSH20 <hash160> OP_EQUAL`
    - `witness_v0_keyhash` (P2WPKH): `0x00 PUSH20 <hash160>`
    - `witness_v0_scripthash` (P2WSH): `0x00 PUSH32 <sha256>`
    - `witness_v1_taproot` (P2TR): `OP_1 PUSH32 <xonly_pubkey>`
    - `nulldata` (OP_RETURN): `OP_RETURN [pushdata...]` with extracted hex payload
  - Returns `{ type, address?, opReturnDataHex? }`.

- `src/infrastructure/bitcoin/raw/TxParser.ts`
  - Parses a single transaction from a `ByteReader` with SegWit awareness.
  - Logic:
    1) Read `version` (4 bytes, LE).
    2) Detect segwit marker/flag: if `00 01`, set `hasWitness` and continue; otherwise rewind and treat as normal.
    3) Read inputs (vin): prevout hash (32 bytes LE), index (4 bytes LE), scriptSig (varint length + bytes), sequence (4 bytes LE).
    4) Read outputs (vout): value (8 bytes LE, sats), scriptPubKey (varint length + bytes). Decode script to get `address/scriptType/opReturn`.
    5) If segwit, read witness stacks for each input.
    6) Read `locktime` (4 bytes LE).
    7) Compute `txid` per BIP-0141: double SHA-256 of the serialization excluding witness data. We construct non-witness serialization from `version`, pre-witness section (from vin count through all vouts), and `locktime`.
  - Output shape: `{ txid, inputs: [...], outputs: [...] }` where outputs include `valueBtc`, `scriptPubKeyHex`, and derived metadata.

- `src/infrastructure/bitcoin/raw/BlockParser.ts`
  - Parses a raw block:
    1) Block header: version, prev block hash, merkle root, time, bits, nonce.
    2) Compute `hash` as double SHA-256 of the 80-byte header and render big-endian via `toHexLE`.
    3) Read tx count (varint) and parse each tx via `TxParser`.
  - Returns `{ hash, version, prevBlock, merkleRoot, time, bits, nonce, transactions }`.

### Network Handling

- On `BitcoinService.connect()`, we call `getblockchaininfo` and map `chain` to:
  - `main` → `mainnet` (HRP `bc`, versions 0x00/0x05)
  - `test`/`signet` → `testnet`/`signet` (HRP `tb`, versions 0x6f/0xc4)
  - otherwise → `regtest` (HRP `bcrt`, versions 0x6f/0xc4)
- The network setting is passed into script decoding and Bech32 address encoding.

### Integration with Services

- The parser is wired behind a configuration flag `PARSE_RAW_BLOCKS`.
  - When `true`, `BitcoinService.parseBlockByHash` fetches raw block hex and header (`getblockheader`) and parses via `parseRawBlock()`.
  - Height/time are taken from the header RPC call; tx inputs can still be resolved via `getrawtransaction` if `RESOLVE_INPUT_ADDRESSES=true`.
  - When `false`, we fall back to `getblock(hash, 2)` and use node-decoded JSON.

### OP_RETURN Handling

- For outputs detected as `nulldata`, we extract the pushdata payload as hex.
- We also compute `opReturnUtf8` as best-effort UTF-8 if the string appears printable.

### Performance Considerations

- Streaming-style `ByteReader` avoids large intermediate copies.
- Transaction ID computation builds a minimal non-witness serialization from known slice boundaries.
- Optional input resolution is kept off by default to avoid extra RPCs.
- Suitable for monitoring ≥1000 addresses; memory stays bounded by processing one block at a time.

### Testing and Fixtures

- Script `bun run test:compare` parses `tests/fixtures/block-4646283-current.raw` and compares coarse stats to `block-4646283-current.json`.
- Extend with more cases as needed (e.g., coinbase, complex witness scripts, Taproot spends).

### Limitations and Future Enhancements

- Script classification focuses on standard templates; nonstandard scripts return `nonstandard` without an address.
- Address derivation does not cover exotic encodings or custom redeem scripts.
- Consider incremental merkle validation and header verification if required in future.


