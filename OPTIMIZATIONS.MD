## Optimizations made (current session)

### 1) Raw parser: reduce allocations in `TxParser`
- **File**: `src/infrastructure/bitcoin/raw/TxParser.ts`
- **Changes**:
  - Do not convert witness stack items to hex strings; simply advance the reader.
  - Do not retain witness arrays on inputs (omit `witness` field).
  - Do not compute or store `scriptPubKeyHex` for outputs (not used by the app/tests).
- **Reason**: Hex conversions and retained strings significantly increase short‑lived allocations and peak RSS without providing value to the app.
- **Effect**: Lower peak memory and GC pressure during block parsing; contributes to higher measured throughput.

### 2) `toHexLE` without buffer copy/reverse
- **File**: `src/infrastructure/bitcoin/raw/ByteReader.ts`
- **Change**: Replaced `Buffer.from(buffer).reverse().toString("hex")` with manual reversed hex generation into a preallocated char array.
- **Reason**: Avoids creating a copied buffer and calling reverse(), reducing allocations and per‑call CPU for every txid/hash conversion.
- **Effect**: Small but consistent CPU/memory savings across all parsed transactions.

### 3) Cache watched address structures in transaction matching
- **File**: `src/application/services/BitcoinService.ts`
- **Change**: Cache `watchSet` and `labelIndex` in an instance field keyed by the `watched` array reference; reuse across `checkTransactions` calls.
- **Reason**: Avoid rebuilding maps on every block/tx scan when `watched` is unchanged; reduces per‑call allocations and improves steady‑state throughput.
- **Effect**: Minor allocation reduction and smoother throughput in sustained scans.

### 5) Omit scriptSig hex and stream txid hashing
- **Files**: `src/infrastructure/bitcoin/raw/TxParser.ts`, `src/infrastructure/bitcoin/raw/ByteReader.ts`
- **Changes**:
  - Do not materialize `scriptSig` as a hex string; just advance the reader.
  - Introduced `sha256dMany(buffers)` to hash without `Buffer.concat`.
- **Reason**: Avoids large transient strings and extra buffer allocations in hot paths.
- **Effect**: Reduced allocations during transaction parsing; slight CPU win.

### 6) Base58 encoding without hex string BigInt
- **File**: `src/infrastructure/bitcoin/raw/Address.ts`
- **Change**: Build `BigInt` directly from bytes instead of `buffer.toString("hex")`.
- **Reason**: Avoids creating an intermediate hex string for every Base58 encode.
- **Effect**: Lower GC pressure when rendering base58 addresses.

### 7) Base58Check preallocation (no Buffer.concat)
- **File**: `src/infrastructure/bitcoin/raw/Address.ts`
- **Change**: Preallocate a single buffer `[version|payload|checksum]` and fill in-place; hash `version|payload` slice to compute checksum.
- **Reason**: Avoid Buffer.concat() x2 and extra ephemeral buffers in hot address encoding path.
- **Effect**: Slightly fewer allocations and CPU, particularly in output-heavy blocks.

### 8) Remove unused lodash import in TxParser
- **File**: `src/infrastructure/bitcoin/raw/TxParser.ts`
- **Change**: Drop unused `lodash-es` import.
- **Reason**: Minor cleanup; ensures no accidental bundling or side effects.
- **Effect**: None functionally; keeps hot file minimal.

### 9) Batch prevout resolution and add prev-tx LRU cache
- **Files**: `src/application/services/BitcoinService.ts`, `src/infrastructure/bitcoin/BitcoinRpcClient.ts`
- **Changes**:
  - Added JSON-RPC batch support and `getRawTransactionVerboseBatch`.
  - `BitcoinService` now deduplicates prevout txids across a block and fetches them in one batch.
  - Introduced a small LRU-ish cache for prev transactions to avoid repeated RPCs across blocks.
- **Reason**: Resolving input addresses previously made 1 RPC per input; batching + caching drastically lowers RPC overhead and latency.
- **Effect**: Lower RPC round-trips, faster block processing when `RESOLVE_INPUT_ADDRESSES=true`.

### 4) Lodash trial and decision
- **Files**: multiple (`BitcoinService`, `config`, `currency`, `raw/TxParser`)
- **Change**: Added `lodash-es` and experimented with replacing native loops/maps with `groupBy`, `map`, `filter`, `find`, and `sumBy` in hot paths.
- **Reason**: Evaluate readability and possible micro‑optimizations from utility functions.
- **Outcome**: No measurable perf gains for the hot loops; reverted most changes to native loops in critical paths. We kept only changes that don’t regress performance.

## Measured outcomes (local runs)
- throughput `max_measured_tps`: ~31k → ~37k (noise exists, but trend improved after parser/caching tweaks)
- raw‑parser `parse_block_ms`: ~1 ms → ~1 ms (unchanged; already fast)
- raw‑parser `mem_max_mb`: previously misreported; now ~97–98 MB with reduced allocations

## Rationale summary
- **Reduce allocations**: removing hex/string materialization (witness, script hex) and avoiding buffer copies directly lowers peak RSS and GC work.
- **Avoid unnecessary work**: only compute/retain data that the app consumes.
- **Reuse state**: cache immutable‑ish structures (`watched` maps) to avoid rebuilding.
- **Measure correctly**: correct metrics to ensure tuning decisions are driven by accurate data.

## Next candidates (not yet implemented)
- Preallocate/Reuse temporary maps/sets in `checkTransactions` to eliminate per‑tx allocations. [DONE]
- Arena or pool for short‑lived strings (addresses/OP_RETURN) if profiling shows string churn.
- Consider streaming parse for very large blocks to further reduce peak RSS if needed.

