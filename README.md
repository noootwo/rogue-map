# RogueMap (Node.js)

[中文文档](./README_zh-CN.md)

A high-performance, memory-efficient key-value store for Node.js, inspired by [RogueMap (Java)](https://roguemap.yomahub.com/).

## Features

- **Off-Heap Storage**: Uses a single large `Buffer` to store data, significantly reducing V8 GC pressure and heap usage.
- **Memory Efficient**: ~50% less memory usage compared to native `Map` for large datasets (millions of items).
- **High Performance**:
  - Fast Writes (Linear Probing + Append-only log).
  - Optimized Reads for Strings (direct buffer comparison).
- **Typed Codecs**: Support for String, Int32, Float64, and JSON (generic) values.
- **Zero Dependencies**: Pure TypeScript/Node.js implementation.

## Installation

```bash
npm install rogue-map
```

## Usage

```typescript
import { RogueMap, StringCodec, Int32Codec } from "rogue-map";

// Create a map optimized for String keys and Int32 values
const map = new RogueMap<string, number>({
  capacity: 1000000, // Initial capacity (buckets)
  initialMemory: 64 * 1024 * 1024, // Initial buffer memory (64MB)
  keyCodec: StringCodec,
  valueCodec: Int32Codec,
});

// Set values
map.set("user:1", 100);
map.set("user:2", 200);

// Get values
console.log(map.get("user:1")); // 100

// Check existence
if (map.has("user:2")) {
  console.log("User 2 exists");
}

// Iteration
for (const [key, value] of map) {
  console.log(key, value);
}

// Delete
map.delete("user:1");

// Clear
map.clear();

// Compact (Garbage Collection)
map.compact();

// Serialize to Buffer
const buffer = map.serialize();
const restored = RogueMap.deserialize(buffer);

// Save/Load to File (Node.js)
import { save, load } from "rogue-map";
await save(map, "data.db");
const loadedMap = await load("data.db");
```

### Configuration & Auto Persistence

RogueMap can automatically manage persistence and compaction via configuration:

```typescript
const map = new RogueMap<string, number>({
  // Auto-detects environment (FS in Node, IndexedDB in Browser)
  persistence: {
    path: "my-db", // File path or DB name
    saveInterval: 5000, // Auto-save every 5s
    // syncLoad: true   // Try to load synchronously on startup (Node only)
  },
  compaction: {
    autoCompact: true, // Enable auto-compaction
    threshold: 0.3, // Compact when 30% of space is wasted
    minSize: 1000, // Minimum size to trigger
  },
});

// For Async environments (Browser IndexedDB), ensure data is loaded:
await map.init();
```

## Benchmarks (1 Million Items)

### Scenario 1: Small Objects (String -> Number)

> Typical "Counter" or "ID Mapping" workload.

| Metric          | Native Map (V8) | RogueMap    | Difference           |
| --------------- | --------------- | ----------- | -------------------- |
| **Write Time**  | ~258ms          | **~204ms**  | **21% Faster** 🚀    |
| **Read Time**   | ~18ms           | ~251ms      | 14x Slower           |
| **Heap Memory** | ~58 MB          | **~0.1 MB** | **99% Reduction** 📉 |
| **Total RSS**   | ~93 MB          | **~37 MB**  | **61% Reduction**    |

### Scenario 2: Large Objects (String -> JSON)

> Storing complex objects. RogueMap serializes them (deep copy), while Native Map stores references.

| Metric          | Native Map (V8) | RogueMap    | Difference                |
| --------------- | --------------- | ----------- | ------------------------- |
| **Write Time**  | ~261ms          | ~550ms      | 2x Slower (JSON overhead) |
| **Heap Memory** | ~104 MB         | **~0.1 MB** | **99% Reduction**         |

> **Key Takeaway**: RogueMap is significantly faster and lighter for scalar data. For complex objects, it trades CPU (serialization) for massive memory savings and off-heap storage.

## Advanced Optimization

### LRU Cache (Hot Read Optimization)

For workloads with "hot" keys, you can enable a small LRU cache to bypass Buffer decoding entirely.
This brings read performance closer to native Map for frequently accessed items.

```typescript
const map = new RogueMap({
  cacheSize: 1000, // Cache last 1000 items in Heap
});
```

| Scenario      | No Cache   | With Cache (Hot) |
| ------------- | ---------- | ---------------- |
| **Hot Read**  | ~158ms     | **~122ms**       |
| **Cold Scan** | **~270ms** | ~800ms           |

> **Note**: Enabling cache adds overhead for cold scans (updating cache) but significantly speeds up repetitive access. Use it only if you have locality of reference.

### Rust Integration (Optional)

This project includes a proof-of-concept Rust accelerator in `native/`.
To use it:

```bash
cd native && cargo build --release
cp target/release/librogue_map_native.dylib native.node
```

## API

### `new RogueMap(options)`

- `capacity`: Initial number of hash buckets (default: 16384).
- `initialMemory`: Initial size of the data buffer in bytes (default: 10MB).
- `keyCodec`: Codec for keys (default: StringCodec).
- `valueCodec`: Codec for values (default: JSONCodec).
- `hasher`: Custom hash function.

### Codecs (Data Types)

RogueMap supports efficient typed storage. Use specific codecs for best performance and memory usage, or `AnyCodec` for flexibility.

- `StringCodec` (Default for Keys)
- `JSONCodec` (Default for Values, uses JSON.stringify)
- `Int32Codec` (4 bytes)
- `Float64Codec` (8 bytes)
- `BooleanCodec` (1 byte)
- `BigInt64Codec` (8 bytes)
- `DateCodec` (8 bytes timestamp)
- `BufferCodec` (Raw binary)
- `AnyCodec` (Auto-detects type, prefixes with type tag)

```typescript
import { RogueMap, BooleanCodec, DateCodec } from "rogue-map";

const map = new RogueMap<string, Date>({
  valueCodec: DateCodec,
});

map.set("created_at", new Date());
```

## Architecture

RogueMap uses a **Linear Probing Hash Table** backed by a single `Buffer`.

- **Buckets**: `Int32Array` storing offsets to the data buffer.
- **Data Buffer**: Stores entries sequentially `[Flag][KeyLen][ValLen][Key][Value]`.
- **Resizing**: Automatically doubles capacity and buffer size when load factor (0.75) or buffer limit is reached.

## License

MIT
