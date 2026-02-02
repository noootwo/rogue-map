# RogueMap 2.0: 高性能读写与架构升级计划

针对您提出的“读写性能不达标”和“API 性能不够好”的问题，我设计了以下深度优化方案。核心策略是**减少数据移动**和**提高内存访问局部性**。

## 核心优化策略

### 1. 智能扩容 (Smart Resize) - *解决写入性能瓶颈*
目前的扩容机制非常昂贵，需要将所有数据从旧 Buffer 复制到新 Buffer。
**新方案**: 分离 "Index Resize" 和 "Data Resize"。
*   **Index Resize (仅扩容哈希表)**: 当 `Load Factor > 0.75` 但 Buffer 仍有空间时，只创建更大的 `buckets/hashes/states` 数组，重新映射现有的 Buffer 数据。**零数据拷贝**，速度极快。
*   **Data Resize (扩容数据区)**: 只有当 Buffer 真正写满时，才进行完整的数据迁移（Compact + Resize）。

### 2. 墓碑复用 (Tombstone Reuse) - *解决空间浪费*
目前的 `delete` 只是标记，必须等 `compact` 才能回收空间。
**新方案**: 在写入发生哈希冲突时，如果遇到 `FLAG_DELETED` 的位置：
*   检查旧 Entry 的空间是否 >= 新 Entry 的空间。
*   如果足够，直接**覆盖写入**旧位置，无需追加到 Buffer 末尾。
*   **收益**: 显著减少 Buffer 增长速度，延缓 `Data Resize` 的触发。

### 3. API 性能重构 - *解决遍历慢的问题*
目前的 `keys()`, `values()`, `entries()` 遍历逻辑较慢。
**新方案**:
*   **Fast Path Iterator**: 针对单页 Buffer（<1GB），实现完全内联的迭代器，利用 `Buffer.subarray` 实现零拷贝 Key/Value 提取。
*   **Lazy Decoding**: 在 `entries()` 中，如果用户只遍历但不使用（或者只用 Key），尽量延迟 Value 的解码（虽然 JS 迭代器机制限制了部分 Lazy 能力，但我们可以优化内部游标移动）。

### 4. 浏览器端 Buffer 兼容性增强
*   确保 `internal/buffer.ts` 在所有边缘情况下都能正确回退，保证浏览器性能与 Node.js 尽可能接近。

## 执行步骤

1.  **重构 Resize 逻辑**:
    *   修改 `set()` 中的触发条件。
    *   拆分 `resize()` 为 `resizeIndex()` (轻量) 和 `resizeData()` (重量)。
    *   实现 `rehash()` 逻辑：仅遍历旧索引，重新计算 bucket 位置。

2.  **实现空间复用**:
    *   在 `put()` 的线性探测循环中，记录遇到的第一个“足够大”的 Tombstone。
    *   如果找到，优先复用该位置。

3.  **完善 API 测试与基准**:
    *   更新 `benchmark_apis.ts`，增加扩容场景的测试，验证 Smart Resize 的效果。
    *   增加 `delete` + `set` 混合场景，验证 Tombstone Reuse 的效果。

4.  **验证**:
    *   运行所有基准测试，目标是写入性能提升 20%+，扩容延迟降低 90%（在 Index Resize 场景下）。

请确认是否开始执行此计划？