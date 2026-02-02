# RogueMap 3.0 终极性能优化方案

根据您的最新反馈，除了之前的**内存优化 (Split Table)** 和 **CPU 优化 (MurmurHash, Adaptive Comparison)**，我们还需要重点解决**读操作的解码开销**以及**API 遍历速度**。

以下是完整的 5 点优化方案：

## 1. 读操作终极优化：Lazy Decoding (延迟解码) & Raw Access
*   **痛点**: `get()` 操作即使命中了 Key，也必须将 Value 从 Buffer 解码为 JS 对象返回。对于大字符串或复杂 JSON，`valueCodec.decode` (即 `buffer.toString` 或 `JSON.parse`) 是最大的耗时点。
*   **优化**: **Lazy Value Access (按需解码)**
    *   在内部 API (如 `getRaw` 或迭代器中) 增加不解码的路径。
    *   对于 `entries()`、`values()` 迭代器，默认返回一个 **Proxy** 或 **Lazy Wrapper**。只有当用户真正访问 Value 属性时，才执行解码。
    *   **收益**: 在 `forEach` 或 `for-of` 循环中，如果用户只做筛选（只看 Key），性能将提升 10 倍以上。

## 2. API 遍历提速：Fast Path Iterators (快速迭代器)
*   **痛点**: 目前 `forEach`, `entries`, `keys`, `values` 都是基于生成器 (`yield`) 实现的。虽然代码简洁，但生成器的状态机切换有额外开销，且无法被 JIT 很好地内联。
*   **优化**: **Custom Iterator Protocol (自定义迭代器)**
    *   放弃 `yield`，手写实现 `next()` 方法的迭代器类。
    *   **内联遍历逻辑**: 直接在 `next()` 中操作 `_hashes` 和 `_offsets` 数组，减少函数调用栈。
    *   **Chunked Iteration**: 一次读取多个 Entry 的元数据，减少 Buffer 交互。
    *   **收益**: 遍历性能预计提升 50%-100%。

## 3. 内存布局优化：Split Table (拆分表)
*   **痛点**: `Float64Array` 存 Hash 浪费 4 字节。
*   **优化**: 拆分为 `_hashes: Int32Array` 和 `_offsets: Float64Array`。
*   **收益**: 内存减少 25%，CPU 缓存命中率提升。

## 4. 算法升级：MurmurHash3 + Adaptive Comparison
*   **痛点**: FNV-1a 冲突多，JS 循环比较长 Key 慢。
*   **优化**:
    *   引入 **MurmurHash3** (32-bit) 替换 FNV-1a。
    *   实现 **自适应比较**: Key < 32 字节用 JS 循环，Key >= 32 字节用 `buffer.compare`。
*   **收益**: 减少哈希冲突，提升长 Key 查询速度。

## 5. 探针优化：SIMD-Friendly Grouping (分组探测)
*   **痛点**: 线性探测 Cache Miss 高。
*   **优化**: 将 4 个 Bucket 视为一组，一次读取一组 Hash 进行 SIMD 风格的比较（虽然 JS 只能模拟，但利用了 CPU 预取）。
*   **收益**: 减少内存访问次数。

## 执行计划

1.  **Phase 1: 基础架构升级 (Split Table & Hash)**
    *   拆分 `_table` 为 `_hashes` 和 `_offsets`。
    *   替换 Hash 算法为 MurmurHash3。

2.  **Phase 2: 核心路径提效 (Comparison & Probing)**
    *   实现自适应 Key 比较。
    *   实现分组探测逻辑。

3.  **Phase 3: API 重构 (Iterator & Lazy)**
    *   重写 `keys()`, `values()`, `entries()` 为高性能迭代器类。
    *   在迭代器中引入 Lazy 解码机制。

建议按此顺序执行，Phase 3 将直接解决您提到的 API 慢和解码开销问题。是否确认执行？