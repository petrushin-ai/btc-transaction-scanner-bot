## Optimizations made (current session)

### 1) Metrics: fix mem_max scaling (accurate MB)
- **File**: `test/_metrics.ts`
- **Change**: Detect whether `process.resourceUsage().maxRSS` is reported in bytes or KiB and convert to MB accordingly.
- **Reason**: Previous metric showed unrealistic values (hundreds of GB) due to unit mismatch, masking real memory usage and hiding improvements.
- **Effect**: `raw-parser.mem_max_mb` now reports realistic values (~98 MB on local runs), enabling meaningful comparisons.

### 2) Raw parser: reduce allocations in `TxParser`
- **File**: `src/infrastructure/bitcoin/raw/TxParser.ts`
- **Changes**:
  - Do not convert witness stack items to hex strings; simply advance the reader.
  - Do not retain witness arrays on inputs (omit `witness` field).
  - Do not compute or store `scriptPubKeyHex` for outputs (not used by the app/tests).
- **Reason**: Hex conversions and retained strings significantly increase short‑lived allocations and peak RSS without providing value to the app.
- **Effect**: Lower peak memory and GC pressure during block parsing; contributes to higher measured throughput.

### 3) `toHexLE` without buffer copy/reverse
- **File**: `src/infrastructure/bitcoin/raw/ByteReader.ts`
- **Change**: Replaced `Buffer.from(buffer).reverse().toString("hex")` with manual reversed hex generation into a preallocated char array.
- **Reason**: Avoids creating a copied buffer and calling reverse(), reducing allocations and per‑call CPU for every txid/hash conversion.
- **Effect**: Small but consistent CPU/memory savings across all parsed transactions.

### 4) Cache watched address structures in transaction matching
- **File**: `src/application/services/BitcoinService.ts`
- **Change**: Cache `watchSet` and `labelIndex` in an instance field keyed by the `watched` array reference; reuse across `checkTransactions` calls.
- **Reason**: Avoid rebuilding maps on every block/tx scan when `watched` is unchanged; reduces per‑call allocations and improves steady‑state throughput.
- **Effect**: Minor allocation reduction and smoother throughput in sustained scans.

### 5) Lodash trial and decision
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
- Preallocate/Reuse temporary maps/sets in `checkTransactions` to eliminate per‑tx allocations.
- Arena or pool for short‑lived strings (addresses/OP_RETURN) if profiling shows string churn.
- Consider streaming parse for very large blocks to further reduce peak RSS if needed.

