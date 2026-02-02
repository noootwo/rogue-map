# RogueMap 2.0 精准提效方案

根据您的反馈，我重新审视了当前性能瓶颈（Resizing、Hot Path Overhead），决定放弃过度工程化的“架构重构”，转而采取**针对耗时大头的精准手术**。

## 核心痛点与优化措施

### 1. 扩容风暴 (Resizing Storm) - *当前最大耗时点*
目前 `resize()` 会将所有数据 **解码(Decode) -> 重新编码(Encode)** 搬运到新 Buffer。这是极其昂贵的。
**优化措施**: **Zero-Decode Resize (原始字节搬运)**
*   在扩容时，直接使用 `Buffer.copy` 将旧 Buffer 中的 Key/Value 原始字节块复制到新 Buffer。
*   完全跳过 Codec 的 `decode` 和 `encode` 过程。
*   **预期收益**: 扩容性能提升 300% 以上（特别是复杂对象场景）。

### 2. 读取热路径 (Read Hot Path) - *日常耗时点*
目前 `get/has` 无论桶是否为空，都会先执行 `keyCodec.encode(key)`。
**优化措施**: **Lazy Encoding (惰性编码)**
*   先计算 Hash（字符串/数字 Hash 很快）。
*   检查对应的 Bucket 是否为空 (`offset === 0`)。
*   只有当 Bucket **不为空**（发生哈希命中或冲突）时，才真正执行 Key 的编码操作来进行字节比对。
*   **预期收益**: 在稀疏 Map 或查找不存在的 Key 时，性能提升显著。

### 3. 数据结构紧凑化 (Compact Layout) - *缓存亲和性*
目前 `buckets`, `hashes`, `states` 是分离的。
**优化措施**: **Interleaved TypedArray (交错数组)**
*   合并为一个 `Float64Array`: `[Hash, Offset, Hash, Offset...]`。
*   利用 `Offset` 的符号位或特殊值来表示 State，移除 `states` 数组。
*   **关键点**: **不引入额外的 Table 类封装**，直接在 `RogueMap` 内部替换数组，保持代码扁平可读。

### 4. 墓碑复用 (Tombstone Reuse) - *空间优化*
**优化措施**:
*   在 `put` 探测过程中，记录遇到的第一个 `Deleted` 槽位。
*   如果当前是新插入操作，优先复用该槽位（需检查 Buffer 空间是否足够，若不够则追加到末尾但复用 Bucket 槽位）。
*   **预期收益**: 减缓 Bucket 数组的膨胀速度。

## 执行步骤

1.  **数据结构升级**:
    *   将 `buckets`, `hashes`, `states` 替换为 `private _table: Float64Array`。
    *   更新所有索引访问逻辑 (`idx * 2`, `idx * 2 + 1`)。

2.  **实现 Zero-Decode Resize**:
    *   重写 `resize()` 方法，直接操作 Buffer 指针进行复制。

3.  **实现 Lazy Encoding**:
    *   调整 `get/has/delete` 逻辑，推迟 `tempKeyBuffer` 的写入时机。

4.  **验证**:
    *   运行 `bench:perf` 和 `bench:apis`，验证性能提升。
    *   运行浏览器基准测试，确保兼容性。

这个方案更加务实，直接针对性能痛点，且不引入过度抽象。请确认是否执行？