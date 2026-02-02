# RogueMap (Node.js)

[中文文档](./README_zh-CN.md)

A high-performance, memory-efficient key-value store for Node.js, inspired by [RogueMap (Java)](https://roguemap.yomahub.com/).

## 🚀 Quick Start (Level 1: The Simple Way)

**Why use RogueMap?**

- Your Node.js app is crashing with **OOM (Out of Memory)** because of a large Map/Object.
- You need to store **millions of items** but don't want to set up Redis.
- You want **persistence** (save to disk) out of the box.

### Installation

```bash
npm install rogue-map
```

### Basic Usage

RogueMap works just like a native `Map`.

```typescript
import { RogueMap } from "rogue-map";

// 1. Create a map (Auto-configured)
const map = new RogueMap();

// 2. Use it like a standard Map
map.set("user:1", { name: "Alice", score: 100 });
map.set("user:2", { name: "Bob", score: 200 });

console.log(map.get("user:1")); // { name: "Alice", score: 100 }
console.log(map.size); // 2

// 3. That's it!
// RogueMap automatically handles memory management and resizing.
```

### Event System

Listen to lifecycle events.

```typescript
const map = new RogueMap();

map.on("set", (key, value) => console.log(`Set: ${key}`));
map.on("delete", (key) => console.log(`Deleted: ${key}`));
map.on("expire", (key) => console.log(`Expired: ${key}`));
map.on("evict", (key, value) => console.log(`Evicted from cache: ${key}`));
map.on("clear", () => console.log("Map cleared"));
```

### Auto-Persistence

Save your data to disk automatically.

```typescript
const map = new RogueMap({
  persistence: {
    path: "data.db", // File path
    saveInterval: 5000, // Save every 5 seconds
  },
});
```

### Time-To-Live (TTL)

Automatically expire entries after a set time.

```typescript
// 1. Set default TTL (e.g., 1 hour)
const map = new RogueMap({ ttl: 3600 * 1000 });

// 2. Override per entry
map.set("session:1", "active", { ttl: 60 * 1000 }); // Expire in 1 min
map.set("config", "permanent", { ttl: 0 }); // Never expire

// 3. Expired items are lazily removed
console.log(map.get("session:1")); // undefined (after 1 min)
```

---

## ⚡️ Power User (Level 2: Typed & Efficient)

By default, RogueMap uses JSON serialization for values (`AnyCodec`), which is flexible but slower.
For 10x performance, use **Typed Codecs** or **Structs**.

### Non-Blocking Iteration (Async)

Iterating over millions of items can block the Node.js event loop. Use `asyncEntries()` to yield control automatically.

```typescript
// Process 1 million items without freezing the server
for await (const [key, val] of map.asyncEntries(100)) {
  // Yields to event loop every 100 items
  await processItem(key, val);
}
```

### Typed Codecs

If you know your data types, tell RogueMap!

```typescript
import { RogueMap, StringCodec, Int32Codec } from "rogue-map";

const map = new RogueMap({
  keyCodec: StringCodec,
  valueCodec: Int32Codec, // Store values as 4-byte integers (Zero GC overhead)
});

map.set("count", 12345);
```

> **⚡️ Performance Boost**:
>
> - **Read Speed**: 20x faster than JSON codec (Zero-Copy Read).
> - **Memory**: Uses exactly 4 bytes per value (vs ~50 bytes overhead for JS Objects).

**Available Codecs:**

- `StringCodec`, `UCS2StringCodec` (Faster for CJK)
- `Int32Codec`, `Float64Codec`, `BigInt64Codec`
- `BooleanCodec`, `DateCodec`, `BufferCodec`

### Structs (Zero-Copy Schemas)

Storing objects? Use `defineStruct` to create a fixed binary layout.
This enables **Lazy Decoding** (Zero-Copy) — reading a property doesn't decode the whole object!

```typescript
import { RogueMap, defineStruct } from "rogue-map";

// 1. Define your data structure
const UserStruct = defineStruct({
  id: "int32", // 4 bytes
  score: "float64", // 8 bytes
  active: "boolean", // 1 byte
  name: "string(20)", // Fixed-length string (20 bytes)
});

// 2. Use it
const map = new RogueMap({
  valueCodec: UserStruct,
});

// 3. Write object
map.set("u1", { id: 1, score: 99.5, active: true, name: "Alice" });

// 4. Zero-Copy Read
const user = map.get("u1");
// 'user' is a View over the buffer. No data is copied yet.
console.log(user.score); // Only reads 8 bytes at offset+4

// 5. In-Place Update (Mutable View)
// You can modify properties directly! The changes are written to buffer instantly.
user.score = 100.0;
```

> **⚡️ Performance Boost**:
>
> - **Read Speed**: **30x faster** than `JSON.parse` (5ms vs 168ms for 1M reads).
> - **Memory**: Compact binary layout (C-Struct style), no field name overhead.

---

## 🛠️ Performance Hacker (Level 3: Deep Optimization)

### UCS-2 Key Storage (Faster for Chinese/Emoji)

If your keys contain many non-ASCII characters (Chinese, Emoji), UTF-8 encoding is slow.
Use `UCS2StringCodec` for **40% faster** reads.

```typescript
import { RogueMap, UCS2StringCodec } from "rogue-map";

const map = new RogueMap({
  keyCodec: UCS2StringCodec,
});
```

> **⚡️ Performance Boost**:
>
> - **Read Speed**: **40% faster** for long CJK strings (513ms vs 867ms).
> - **CPU**: Avoids expensive UTF-8 encoding/decoding for every operation.

### LRU Cache (Hot Read Optimization)

Off-heap storage has a decoding cost. Enable a small LRU cache to keep "hot" items in V8 heap for instant access.

```typescript
const map = new RogueMap({
  cacheSize: 1000, // Keep last 1000 accessed items in memory
});
```

> **⚡️ Performance Boost**:
>
> - **Read Speed**: **5x faster** for hot items (84ms vs 399ms).
> - **Latency**: Brings performance on par with native Map for frequently accessed data.

### Performance Benchmarks (1 Million Items)

| Metric          | Native Map | RogueMap (Default) | RogueMap (Optimized) |
| :-------------- | :--------- | :----------------- | :------------------- |
| **Write Time**  | ~234ms     | ~258ms             | **~258ms**           |
| **Read Time**   | ~18ms      | ~399ms             | **~84ms** (w/ Cache) |
| **Heap Memory** | ~58 MB     | **~0.03 MB**       | **~0.03 MB**         |

> **Conclusion**: RogueMap writes as fast as Native Map, but uses **99.9% less memory**.

---

## Architecture

RogueMap uses a **Linear Probing Hash Table** backed by a **Paged Buffer** system.

- **Off-Heap**: Data lives in Node.js `Buffer` (C++ memory), hiding it from the Garbage Collector.
- **Paged Buffer**: Breaks the 2GB/4GB buffer limit, supporting datasets larger than RAM (via OS swap/mmap in future).
- **Zero-Allocation**: Core read/write paths are optimized to avoid creating temporary objects.

## License

MIT
