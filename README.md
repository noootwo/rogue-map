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

## Performance Comparison (By Scale)

### 10k Items

| Type         | Write Time | Read Time | Heap Used   | Total RSS |
| ------------ | ---------- | --------- | ----------- | --------- |
| **Object**   | 3ms        | 1ms       | 0.61 MB     | 0.63 MB   |
| **Map**      | 1ms        | 2ms       | 0.67 MB     | 0.47 MB   |
| **RogueMap** | 11ms       | 8ms       | **0.04 MB** | 1.48 MB   |

### 100k Items

| Type         | Write Time | Read Time | Heap Used   | Total RSS |
| ------------ | ---------- | --------- | ----------- | --------- |
| **Object**   | 37ms       | 14ms      | 8.28 MB     | 10.66 MB  |
| **Map**      | **12ms**   | **2ms**   | 5.79 MB     | 5.27 MB   |
| **RogueMap** | 38ms       | 34ms      | **0.04 MB** | 20.55 MB  |

### 1M Items

| Type         | Write Time | Read Time | Heap Used   | Total RSS |
| ------------ | ---------- | --------- | ----------- | --------- |
| **Object**   | 505ms      | 282ms     | 77.75 MB    | 113.84 MB |
| **Map**      | **299ms**  | **19ms**  | 57.75 MB    | 53.13 MB  |
| **RogueMap** | 454ms      | 397ms     | **0.06 MB** | 64.84 MB  |

### 10M Items

| Type         | Write Time     | Read Time | Heap Used   | Total RSS  |
| ------------ | -------------- | --------- | ----------- | ---------- |
| **Object**   | ❌ (OOM/Crash) | ❌        | -           | -          |
| **Map**      | ❌ (OOM/Crash) | ❌        | -           | -          |
| **RogueMap** | **~4.6s**      | **~4.5s** | **0.06 MB** | **404 MB** |

### 100M Items

| Type         | Write Time | Read Time | Heap Used | Total RSS   |
| ------------ | ---------- | --------- | --------- | ----------- |
| **Object**   | ❌         | ❌        | -         | -           |
| **Map**      | ❌         | ❌        | -         | -           |
| **RogueMap** | **~56s**   | **~35s**  | **6 MB**  | **5.44 GB** |

> **Environment**: macOS, Node.js v22. (Single Thread)
> **Conclusion**:
>
> 1. **Small Scale (<100k)**: Native Map/Object are extremely fast. RogueMap has minor initial overhead.
> 2. **Medium Scale (1M)**: RogueMap write performance catches up to Object, with near-zero Heap usage.
> 3. **Large Scale (>10M)**: **RogueMap is the only viable choice**. Native structures crash or OOM, while RogueMap runs stably with minimal Heap impact.

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

RogueMap uses a **Linear Probing Hash Table** backed by a **Paged Buffer** system.

- **Buckets**: `Float64Array` storing 64-bit offsets to the data buffer (supports >4GB address space).
- **Paged Buffer**: A wrapper around multiple Node.js Buffers (default 1GB pages) to bypass the 2GB/4GB single-buffer limit.
- **Data Layout**: Entries are stored sequentially `[Flag][KeyLen][ValLen][Key][Value]`.
- **Resizing**: Automatically doubles capacity and buffer size when load factor (0.75) or buffer limit is reached.

## License

MIT
