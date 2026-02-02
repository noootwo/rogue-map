import { Buffer } from "./internal/buffer";

/**
 * PagedBuffer: A wrapper around multiple Node.js Buffers to support sizes > 2GB/4GB.
 *
 * Uses a fixed page size (default 1GB) to split data across multiple buffers.
 * Provides a Buffer-like API for seamless integration.
 */
export class PagedBuffer {
  // 1GB Page Size (2^30)
  // Using 1GB avoids signed 32-bit issues within a page and fits comfortably in Node's limits.
  static readonly PAGE_SIZE = 1073741824;
  static readonly PAGE_SHIFT = 30;
  static readonly PAGE_MASK = 0x3fffffff;

  private pages: Buffer[];
  private _length: number;
  private singlePage: Buffer | null; // Optimization for single-page scenarios

  constructor(initialSize: number) {
    this._length = initialSize;
    const numPages = Math.ceil(initialSize / PagedBuffer.PAGE_SIZE);
    this.pages = new Array(numPages);

    let remaining = initialSize;
    for (let i = 0; i < numPages; i++) {
      const size = Math.min(remaining, PagedBuffer.PAGE_SIZE);
      this.pages[i] = Buffer.allocUnsafe(size);
      remaining -= size;
    }

    this.singlePage = numPages === 1 ? this.pages[0] : null;
  }

  getSinglePage(): Buffer | null {
    return this.singlePage;
  }

  get length(): number {
    return this._length;
  }

  static allocUnsafe(size: number): PagedBuffer {
    return new PagedBuffer(size);
  }

  resize(newSize: number): void {
    if (newSize === this._length) return;

    const oldPages = this.pages;
    const numPages = Math.ceil(newSize / PagedBuffer.PAGE_SIZE);
    this.pages = new Array(numPages);
    this._length = newSize;

    let remaining = newSize;
    for (let i = 0; i < numPages; i++) {
      const size = Math.min(remaining, PagedBuffer.PAGE_SIZE);
      if (i < oldPages.length) {
        // Reuse or Resize existing page
        if (oldPages[i].length >= size) {
          this.pages[i] = oldPages[i].subarray(0, size);
        } else {
          const newPage = Buffer.allocUnsafe(size);
          oldPages[i].copy(newPage);
          this.pages[i] = newPage;
        }
      } else {
        // New page
        this.pages[i] = Buffer.allocUnsafe(size);
      }
      remaining -= size;
    }

    this.singlePage = numPages === 1 ? this.pages[0] : null;
  }

  readUInt8(offset: number): number {
    if (this.singlePage) return this.singlePage.readUInt8(offset);

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;
    return this.pages[pageIdx].readUInt8(pageOffset);
  }

  writeUInt8(value: number, offset: number): void {
    if (this.singlePage) {
      this.singlePage.writeUInt8(value, offset);
      return;
    }

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;
    this.pages[pageIdx].writeUInt8(value, pageOffset);
  }

  readInt32LE(offset: number): number {
    if (this.singlePage) return this.singlePage.readInt32LE(offset);

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;

    // Fast path: fits in one page
    if (pageOffset + 4 <= PagedBuffer.PAGE_SIZE) {
      return this.pages[pageIdx].readInt32LE(pageOffset);
    }

    // Slow path: cross-boundary
    return this.readMultiByte(offset, 4).readInt32LE(0);
  }

  writeInt32LE(value: number, offset: number): void {
    if (this.singlePage) {
      this.singlePage.writeInt32LE(value, offset);
      return;
    }

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;

    if (pageOffset + 4 <= PagedBuffer.PAGE_SIZE) {
      this.pages[pageIdx].writeInt32LE(value, pageOffset);
      return;
    }

    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32LE(value, 0);
    this.writeMultiByte(buf, offset);
  }

  readUInt32LE(offset: number): number {
    if (this.singlePage) return this.singlePage.readUInt32LE(offset);

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;

    if (pageOffset + 4 <= PagedBuffer.PAGE_SIZE) {
      return this.pages[pageIdx].readUInt32LE(pageOffset);
    }

    return this.readMultiByte(offset, 4).readUInt32LE(0);
  }

  writeUInt32LE(value: number, offset: number): void {
    if (this.singlePage) {
      this.singlePage.writeUInt32LE(value, offset);
      return;
    }

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;

    if (pageOffset + 4 <= PagedBuffer.PAGE_SIZE) {
      this.pages[pageIdx].writeUInt32LE(value, pageOffset);
      return;
    }

    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(value, 0);
    this.writeMultiByte(buf, offset);
  }

  // Helper for cross-boundary reads
  private readMultiByte(offset: number, length: number): Buffer {
    const res = Buffer.allocUnsafe(length);
    this.copy(res, 0, offset, offset + length);
    return res;
  }

  // Helper for cross-boundary writes
  private writeMultiByte(buf: Buffer, offset: number): void {
    let currentOffset = offset;
    let bufOffset = 0;
    let remaining = buf.length;

    while (remaining > 0) {
      const pageIdx = Math.floor(currentOffset / PagedBuffer.PAGE_SIZE);
      const pageOffset = currentOffset % PagedBuffer.PAGE_SIZE;
      const toWrite = Math.min(remaining, PagedBuffer.PAGE_SIZE - pageOffset);

      buf.copy(this.pages[pageIdx], pageOffset, bufOffset, bufOffset + toWrite);

      currentOffset += toWrite;
      bufOffset += toWrite;
      remaining -= toWrite;
    }
  }

  copy(
    target: Buffer | Uint8Array,
    targetStart: number,
    sourceStart: number,
    sourceEnd: number,
  ): number {
    if (this.singlePage) {
      return this.singlePage.copy(
        target as Buffer,
        targetStart,
        sourceStart,
        sourceEnd,
      );
    }

    let currentSource = sourceStart;
    let currentTarget = targetStart;
    let remaining = sourceEnd - sourceStart;
    const total = remaining;

    while (remaining > 0) {
      const pageIdx = Math.floor(currentSource / PagedBuffer.PAGE_SIZE);
      const pageOffset = currentSource % PagedBuffer.PAGE_SIZE;
      const toCopy = Math.min(remaining, PagedBuffer.PAGE_SIZE - pageOffset);

      this.pages[pageIdx].copy(
        target as Buffer,
        currentTarget,
        pageOffset,
        pageOffset + toCopy,
      );

      currentSource += toCopy;
      currentTarget += toCopy;
      remaining -= toCopy;
    }
    return total;
  }

  // Special copy method for resizing (PagedBuffer -> PagedBuffer)
  copyToPaged(
    target: PagedBuffer,
    targetStart: number,
    sourceStart: number,
    sourceEnd: number,
  ): void {
    let currentSource = sourceStart;
    let currentTarget = targetStart;
    let remaining = sourceEnd - sourceStart;

    while (remaining > 0) {
      const srcPageIdx = Math.floor(currentSource / PagedBuffer.PAGE_SIZE);
      const srcPageOffset = currentSource % PagedBuffer.PAGE_SIZE;

      const tgtPageIdx = Math.floor(currentTarget / PagedBuffer.PAGE_SIZE);
      const tgtPageOffset = currentTarget % PagedBuffer.PAGE_SIZE;

      const toCopy = Math.min(
        remaining,
        PagedBuffer.PAGE_SIZE - srcPageOffset,
        PagedBuffer.PAGE_SIZE - tgtPageOffset,
      );

      this.pages[srcPageIdx].copy(
        target.pages[tgtPageIdx],
        tgtPageOffset,
        srcPageOffset,
        srcPageOffset + toCopy,
      );

      currentSource += toCopy;
      currentTarget += toCopy;
      remaining -= toCopy;
    }
  }

  compare(
    target: Buffer,
    targetStart: number,
    targetEnd: number,
    sourceStart: number,
    sourceEnd: number,
  ): number {
    if (this.singlePage) {
      return this.singlePage.compare(
        target,
        targetStart,
        targetEnd,
        sourceStart,
        sourceEnd,
      );
    }

    // Compare THIS (source) with TARGET (standard Buffer)
    // Used for key comparison
    const len = sourceEnd - sourceStart;
    const targetLen = targetEnd - targetStart;
    if (len !== targetLen) return len - targetLen;

    let currentSource = sourceStart;
    let currentTarget = targetStart;
    let remaining = len;

    while (remaining > 0) {
      const pageIdx = Math.floor(currentSource / PagedBuffer.PAGE_SIZE);
      const pageOffset = currentSource % PagedBuffer.PAGE_SIZE;
      const toCheck = Math.min(remaining, PagedBuffer.PAGE_SIZE - pageOffset);

      const res = this.pages[pageIdx].compare(
        target,
        currentTarget,
        currentTarget + toCheck,
        pageOffset,
        pageOffset + toCheck,
      );

      if (res !== 0) return res;

      currentSource += toCheck;
      currentTarget += toCheck;
      remaining -= toCheck;
    }

    return 0;
  }

  // For direct writing of buffers (keys/values)
  writeBuffer(buf: Buffer, offset: number): void {
    if (this.singlePage) {
      // Optimization: Single page
      // Use copy logic from Buffer
      // buf.copy(this.singlePage, offset)
      // Wait, writeBuffer signature: writeBuffer(buf, offset) means "write buf INTO this at offset"
      // Buffer.copy(target, targetStart, sourceStart, sourceEnd)
      // So: buf.copy(this.singlePage, offset)
      buf.copy(this.singlePage, offset);
      return;
    }
    this.writeMultiByte(buf, offset);
  }

  // Zero-Copy View Access
  // Returns { buffer, offset } if fits in a single page
  // Returns null if cross-boundary (requires allocation)
  tryGetView(
    offset: number,
    length: number,
  ): { buffer: Buffer; offset: number } | null {
    if (this.singlePage) {
      return { buffer: this.singlePage, offset };
    }

    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;

    if (pageOffset + length <= PagedBuffer.PAGE_SIZE) {
      return { buffer: this.pages[pageIdx], offset: pageOffset };
    }

    return null;
  }

  // For reading buffers (decoding)
  readBuffer(offset: number, length: number): Buffer {
    if (this.singlePage) {
      return this.singlePage.subarray(offset, offset + length);
    }

    // Optimization: Single page within multi-page
    const pageIdx = Math.floor(offset / PagedBuffer.PAGE_SIZE);
    const pageOffset = offset % PagedBuffer.PAGE_SIZE;
    if (pageOffset + length <= PagedBuffer.PAGE_SIZE) {
      return this.pages[pageIdx].subarray(pageOffset, pageOffset + length);
    }
    return this.readMultiByte(offset, length);
  }
}
