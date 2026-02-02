# RogueMap (Node.js)

A high-performance, memory-efficient key-value store for Node.js, inspired by [RogueMap (Java)](https://roguemap.yomahub.com/).

## 🚀 快速开始 (Level 1: 简单易用)

**为什么选择 RogueMap?**

- 你的 Node.js 应用因为巨大的 Map/Object 而频繁崩溃 (**OOM**)。
- 你需要存储**数百万条数据**但不想引入 Redis 等外部依赖。
- 你需要开箱即用的**数据持久化**（保存到磁盘）。

### 安装

```bash
npm install rogue-map
```

### 基础用法

RogueMap 的用法与原生 `Map` 几乎一致。

```typescript
import { RogueMap } from "rogue-map";

// 1. 创建 Map (自动配置)
const map = new RogueMap();

// 2. 像标准 Map 一样使用
map.set("user:1", { name: "Alice", score: 100 });
map.set("user:2", { name: "Bob", score: 200 });

console.log(map.get("user:1")); // { name: "Alice", score: 100 }
console.log(map.size); // 2

// 3. 就是这么简单!
// RogueMap 会自动管理内存、扩容和垃圾回收。
```

### 事件系统 (Event System)

监听生命周期事件。

```typescript
const map = new RogueMap();

map.on("set", (key, value) => console.log(`设置: ${key}`));
map.on("delete", (key) => console.log(`删除: ${key}`));
map.on("expire", (key) => console.log(`过期: ${key}`));
map.on("evict", (key, value) => console.log(`从缓存淘汰: ${key}`));
map.on("clear", () => console.log("清空 Map"));
```

### 自动持久化

通过简单配置即可自动保存数据到磁盘。

```typescript
const map = new RogueMap({
  persistence: {
    path: "data.db", // 文件路径
    saveInterval: 5000, // 每 5 秒自动保存一次
  },
});
```

### 自动过期 (TTL)

支持为数据设置过期时间，自动清理过期条目。

```typescript
// 1. 设置默认 TTL (例如 1 小时)
const map = new RogueMap({ ttl: 3600 * 1000 });

// 2. 覆盖单个条目的 TTL
map.set("session:1", "active", { ttl: 60 * 1000 }); // 1 分钟后过期
map.set("config", "permanent", { ttl: 0 }); // 永不过期

// 3. 过期条目会被惰性删除
console.log(map.get("session:1")); // undefined (1 分钟后)
```

---

## ⚡️ 进阶使用 (Level 2: 类型化与高效)

默认情况下，RogueMap 使用 JSON 序列化存储值 (`AnyCodec`)，这很灵活但相对较慢。
为了获得 **10倍以上的性能提升**，请使用 **类型化 Codec** 或 **Struct**。

### 非阻塞迭代 (Async Iterators)

遍历数百万条数据可能会阻塞 Node.js 事件循环。使用 `asyncEntries()` 可以自动让出执行权。

```typescript
// 遍历 100 万条数据而不卡顿服务器
for await (const [key, val] of map.asyncEntries(100)) {
  // 每 100 条数据让出一次事件循环
  await processItem(key, val);
}
```

### 类型化 Codec (Typed Codecs)

如果你知道数据的具体类型，请告诉 RogueMap！

```typescript
import { RogueMap, StringCodec, Int32Codec } from "rogue-map";

const map = new RogueMap({
  keyCodec: StringCodec,
  valueCodec: Int32Codec, // 将值存储为 4 字节整数 (零 GC 开销)
});

map.set("count", 12345);
```

> **⚡️ 性能提升**:
>
> - **读取速度**: 比 JSON Codec 快 **20倍** (零拷贝读取)。
> - **内存占用**: 每个值仅占用 4 字节 (原生 JS 对象通常有 50+ 字节的开销)。

**可用 Codecs:**

- `StringCodec`, `UCS2StringCodec` (适合中文场景)

* `Int32Codec`, `Float64Codec`, `BigInt64Codec`
* `BooleanCodec`, `DateCodec`, `BufferCodec`

### 结构体 (Structs - 零拷贝模式)

存储对象？使用 `defineStruct` 定义固定的二进制布局。
这开启了 **懒解码 (Lazy Decoding)** 能力 —— 读取属性时不会解码整个对象！

```typescript
import { RogueMap, defineStruct } from "rogue-map";

// 1. 定义数据结构
const UserStruct = defineStruct({
  id: "int32", // 4 字节
  score: "float64", // 8 字节
  active: "boolean", // 1 字节
  name: "string(20)", // 定长字符串 (20 字节)
});

// 2. 使用结构体
const map = new RogueMap({
  valueCodec: UserStruct,
});

// 3. 写入对象
map.set("u1", { id: 1, score: 99.5, active: true, name: "Alice" });

// 4. 零拷贝读取
const user = map.get("u1");
// 'user' 是 Buffer 的视图 (View)。此时没有发生任何数据拷贝。
console.log(user.score); // 仅读取 offset+4 处的 8 个字节

// 5. 就地更新 (Mutable View)
// 你可以直接修改属性！更改会立即写入底层 Buffer。
user.score = 100.0;
```

> **⚡️ 性能提升**:
>
> - **读取速度**: 比 `JSON.parse` 快 **30倍** (5ms vs 168ms @ 100万次读取)。
> - **内存**: 紧凑的二进制布局 (C 语言结构体风格)，无字段名开销。

---

## 🛠️ 极客优化 (Level 3: 深度调优)

### UCS-2 Key 存储 (中文/Emoji 优化)

如果你的 Key 包含大量非 ASCII 字符（中文、Emoji），UTF-8 编码会比较慢。
使用 `UCS2StringCodec` 可获得 **40% 的读取性能提升**。

```typescript
import { RogueMap, UCS2StringCodec } from "rogue-map";

const map = new RogueMap({
  keyCodec: UCS2StringCodec,
});
```

> **⚡️ 性能提升**:
>
> - **读取速度**: 在长中文 Key 场景下快 **40%** (513ms vs 867ms)。
> - **CPU**: 避免了每次操作都进行昂贵的 UTF-8 编解码。

### LRU 缓存 (热点读取优化)

堆外存储会有一定的解码开销。启用一个小的 LRU 缓存可以将“热点”数据保留在 V8 堆内存中，实现极速访问。

```typescript
const map = new RogueMap({
  cacheSize: 1000, // 在内存中缓存最近使用的 1000 个项目
});
```

> **⚡️ 性能提升**:
>
> - **读取速度**: 热点数据读取快 **5倍** (84ms vs 399ms)。
> - **延迟**: 使得热点数据的访问性能与原生 Map 持平。

### 性能基准 (100万条数据)

| 指标           | 原生 Map | RogueMap (默认) | RogueMap (优化后)  |
| :------------- | :------- | :-------------- | :----------------- |
| **写入耗时**   | ~234ms   | ~258ms          | **~258ms**         |
| **读取耗时**   | ~18ms    | ~399ms          | **~84ms** (带缓存) |
| **堆内存占用** | ~58 MB   | **~0.03 MB**    | **~0.03 MB**       |

> **结论**: RogueMap 写入速度与原生 Map 持平，但**节省了 99.9% 的内存**。

---

## 架构原理

RogueMap 使用基于 **分页缓冲 (Paged Buffer)** 系统的 **线性探测哈希表 (Linear Probing Hash Table)**。

- **堆外存储 (Off-Heap)**: 数据存活在 Node.js `Buffer` (C++ 内存) 中，对 V8 垃圾回收器 (GC) 不可见。
- **分页缓冲**: 突破 2GB/4GB 单个 Buffer 限制，支持大于 RAM 的数据集 (未来支持 mmap)。
- **零分配 (Zero-Allocation)**: 核心读写路径经过深度优化，避免创建临时对象。

## License

MIT
