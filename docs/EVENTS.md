## Domain Events and JSON Examples (v1)

This document lists the internal domain events and their JSON structure. Unless noted, timestamps are ISO‑8601 strings; heights are integers; `block.time` is UNIX epoch seconds; `valueBtc` is a number in BTC; `valueUsd` is a number in USD when available.

Compatibility policy:
- v1 is additive‑friendly. New optional fields may be added; existing fields will not change semantics.

### BlockDetected (v1)

```json
{
  "type": "BlockDetected",
  "timestamp": "2024-05-01T12:34:56.789Z",
  "height": 834000,
  "hash": "0000000000000000000abcdef...",
  "dedupeKey": "BlockDetected:834000:000000...",
  "eventId": "BlockDetected:834000:000000..."
}
```

Notes:
- **height**: chain height after new block connects.
- **hash**: block hash.

### BlockParsed (v1)

```json
{
  "type": "BlockParsed",
  "timestamp": "2024-05-01T12:34:57.012Z",
  "block": {
    "hash": "0000000000000000000abcdef...",
    "prevHash": "0000000000000000000abcde0...",
    "height": 834000,
    "time": 1714563294,
    "transactions": [
      {
        "txid": "abc123...",
        "inputs": [ { "address": "bc1q...", "valueBtc": 0.1 } ],
        "outputs": [
          { "address": "bc1q...", "valueBtc": 0.0999, "scriptType": "witness_v0_keyhash" },
          { "valueBtc": 0.0001, "scriptType": "nulldata", "opReturnDataHex": "48656c6c6f", "opReturnUtf8": "Hello" }
        ]
      }
    ]
  },
  "dedupeKey": "BlockParsed:834000:000000...",
  "eventId": "BlockParsed:834000:000000..."
}
```

Notes:
- **block.time**: UNIX seconds from the node.
- **outputs.scriptType**: matches Bitcoin Core `scriptPubKey.type`.

### AddressActivityFound (v1)

```json
{
  "type": "AddressActivityFound",
  "timestamp": "2024-05-01T12:34:57.345Z",
  "block": { "hash": "000000...", "height": 834000, "time": 1714563294 },
  "activity": {
    "address": "bc1q...",
    "label": "wallet-1",
    "txid": "abc123...",
    "direction": "in",
    "valueBtc": 0.01234567,
    "valueUsd": 882.34,
    "opReturnHex": "48656c6c6f20576f726c64",
    "opReturnUtf8": "Hello World"
  },
  "dedupeKey": "AddressActivity:834000:000000...:bc1q...:abc123...:in",
  "eventId": "AddressActivity:834000:000000...:bc1q...:abc123...:in"
}
```

Notes:
- **direction**: "in" for net positive to the address, "out" for net negative.
- **valueUsd**: present only when USD rate is configured.
- **OP_RETURN**: echoed if present anywhere in the tx.

### NotificationEmitted (v1)

```json
{
  "type": "NotificationEmitted",
  "timestamp": "2024-05-01T12:34:57.456Z",
  "channel": "stdout",
  "ok": true,
  "details": { "address": "bc1q...", "txid": "abc123..." },
  "dedupeKey": "Notification:834000:000000...:bc1q...:abc123...:in",
  "eventId": "Notification:834000:000000...:bc1q...:abc123...:in"
}
```

Notes:
- **channel**: one of "logger", "webhook", "stdout", "file", "kafka", "nats".
- **details**: sink-defined payload; best-effort context for audits/metrics.

### BlockReorg (v1)

```json
{
  "type": "BlockReorg",
  "timestamp": "2024-05-01T12:34:58.000Z",
  "height": 833999,
  "oldHash": "0000000000000000000reorgOld...",
  "newHash": "0000000000000000000reorgNew...",
  "eventId": "BlockReorg:833999:000000...->000000...",
  "dedupeKey": "BlockReorg:833999:000000...:000000..."
}
```

Notes:
- Indicates a rollback of the block at `height`; downstream systems may need to compensate.

### Units and field notes (quick reference)
- **timestamp**: ISO‑8601 string (UTC)
- **height**: integer
- **hash/txid**: hex string
- **block.time**: UNIX epoch seconds (number)
- **valueBtc**: BTC as a decimal number
- **valueUsd**: USD as a decimal number (optional)
- **dedupeKey/eventId**: deterministic strings for idempotency


