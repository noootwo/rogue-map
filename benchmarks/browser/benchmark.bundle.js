"use strict";
(() => {
  // src/codecs.ts
  var StringCodec = {
    encode(value, buffer, offset) {
      return buffer.write(value, offset);
    },
    decode(buffer, offset, length = 0) {
      return buffer.toString("utf8", offset, offset + length);
    },
    byteLength(value) {
      return Buffer.byteLength(value);
    },
    fixedLength: void 0
  };
  var Int32Codec = {
    encode(value, buffer, offset) {
      return buffer.writeInt32LE(value, offset);
    },
    decode(buffer, offset) {
      return buffer.readInt32LE(offset);
    },
    byteLength() {
      return 4;
    },
    fixedLength: 4
  };
  var AnyCodec = {
    encode(value, buffer, offset) {
      if (value === null || value === void 0) {
        buffer.writeUInt8(0, offset);
        return 1;
      }
      if (typeof value === "boolean") {
        buffer.writeUInt8(1, offset);
        buffer.writeUInt8(value ? 1 : 0, offset + 1);
        return 2;
      }
      if (typeof value === "number") {
        if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
          buffer.writeUInt8(2, offset);
          buffer.writeInt32LE(value, offset + 1);
          return 5;
        }
        buffer.writeUInt8(3, offset);
        buffer.writeDoubleLE(value, offset + 1);
        return 9;
      }
      if (typeof value === "string") {
        buffer.writeUInt8(4, offset);
        const len2 = buffer.write(value, offset + 1);
        return 1 + len2;
      }
      if (typeof value === "bigint") {
        buffer.writeUInt8(8, offset);
        buffer.writeBigInt64LE(value, offset + 1);
        return 9;
      }
      if (value instanceof Date) {
        buffer.writeUInt8(5, offset);
        buffer.writeDoubleLE(value.getTime(), offset + 1);
        return 9;
      }
      if (Buffer.isBuffer(value)) {
        buffer.writeUInt8(7, offset);
        value.copy(buffer, offset + 1);
        return 1 + value.length;
      }
      buffer.writeUInt8(6, offset);
      const str = JSON.stringify(value);
      const len = buffer.write(str, offset + 1);
      return 1 + len;
    },
    decode(buffer, offset, length = 0) {
      const type = buffer.readUInt8(offset);
      const dataOffset = offset + 1;
      const dataLen = length - 1;
      switch (type) {
        case 0:
          return null;
        case 1:
          return buffer.readUInt8(dataOffset) === 1;
        case 2:
          return buffer.readInt32LE(dataOffset);
        case 3:
          return buffer.readDoubleLE(dataOffset);
        case 4:
          return buffer.toString("utf8", dataOffset, dataOffset + dataLen);
        case 5:
          return new Date(buffer.readDoubleLE(dataOffset));
        case 6:
          return JSON.parse(
            buffer.toString("utf8", dataOffset, dataOffset + dataLen)
          );
        case 7: {
          const res = Buffer.allocUnsafe(dataLen);
          buffer.copy(res, 0, dataOffset, dataOffset + dataLen);
          return res;
        }
        case 8:
          return buffer.readBigInt64LE(dataOffset);
        default:
          return void 0;
      }
    },
    byteLength(value) {
      if (value === null || value === void 0) return 1;
      if (typeof value === "boolean") return 2;
      if (typeof value === "number") {
        if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
          return 5;
        return 9;
      }
      if (typeof value === "string") return 1 + Buffer.byteLength(value);
      if (typeof value === "bigint") return 9;
      if (value instanceof Date) return 9;
      if (Buffer.isBuffer(value)) return 1 + value.length;
      return 1 + Buffer.byteLength(JSON.stringify(value));
    },
    fixedLength: void 0
  };

  // src/utils.ts
  function fnv1a(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function numberHash(num) {
    num = ~num + (num << 15);
    num = num ^ num >>> 12;
    num = num + (num << 2);
    num = num ^ num >>> 4;
    num = Math.imul(num, 2057);
    num = num ^ num >>> 16;
    return num >>> 0;
  }

  // benchmarks/browser/shims/empty.js
  var readFileSync = () => {
  };
  var writeFileSync = () => {
  };
  var promises = {
    readFile: async () => {
    },
    writeFile: async () => {
    },
    unlink: async () => {
    }
  };
  var dirname = (p) => p;

  // src/persistence/fs.ts
  var FileSystemAdapter = class {
    async save(data, filePath) {
      await promises.mkdir(dirname(filePath), { recursive: true });
      await promises.writeFile(filePath, data);
    }
    saveSync(data, filePath) {
      (void 0)(dirname(filePath), { recursive: true });
      writeFileSync(filePath, data);
    }
    async load(filePath) {
      try {
        return await promises.readFile(filePath);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    }
    loadSync(filePath) {
      try {
        return readFileSync(filePath);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    }
  };

  // src/persistence/browser.ts
  var IndexedDBAdapter = class {
    dbName = "RogueMapDB";
    storeName = "store";
    async openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          db.createObjectStore(this.storeName);
        };
      });
    }
    async save(data, key) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.put(data, key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
    saveSync(data, key) {
      throw new Error("IndexedDB does not support synchronous operations.");
    }
    async load(key) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          if (!result) resolve(null);
          else resolve(Buffer.from(result));
        };
      });
    }
    loadSync(key) {
      throw new Error("IndexedDB does not support synchronous operations.");
    }
  };
  var LocalStorageAdapter = class {
    save(data, key) {
      this.saveSync(data, key);
      return Promise.resolve();
    }
    saveSync(data, key) {
      const base64 = data.toString("base64");
      localStorage.setItem(key, base64);
    }
    load(key) {
      return Promise.resolve(this.loadSync(key));
    }
    loadSync(key) {
      const base64 = localStorage.getItem(key);
      if (!base64) return null;
      return Buffer.from(base64, "base64");
    }
  };

  // src/persistence/manager.ts
  var PersistenceManager = class {
    static getAdapter(type = "auto") {
      if (type === "auto") {
        if (typeof process !== "undefined" && process.versions && process.versions.node) {
          return new FileSystemAdapter();
        }
        if (typeof indexedDB !== "undefined") {
          return new IndexedDBAdapter();
        }
        if (typeof localStorage !== "undefined") {
          return new LocalStorageAdapter();
        }
        throw new Error("No suitable persistence adapter found.");
      }
      switch (type) {
        case "fs":
          return new FileSystemAdapter();
        case "indexeddb":
          return new IndexedDBAdapter();
        case "localstorage":
          return new LocalStorageAdapter();
        case "memory":
          return {
            save: async () => {
            },
            saveSync: () => {
            },
            load: async () => null,
            loadSync: () => null
          };
        default:
          throw new Error(`Unknown persistence type: ${type}`);
      }
    }
  };

  // src/PagedBuffer.ts
  var PagedBuffer = class _PagedBuffer {
    // 1GB Page Size (2^30)
    // Using 1GB avoids signed 32-bit issues within a page and fits comfortably in Node's limits.
    static PAGE_SIZE = 1073741824;
    static PAGE_SHIFT = 30;
    static PAGE_MASK = 1073741823;
    pages;
    _length;
    singlePage;
    // Optimization for single-page scenarios
    constructor(initialSize) {
      this._length = initialSize;
      const numPages = Math.ceil(initialSize / _PagedBuffer.PAGE_SIZE);
      this.pages = new Array(numPages);
      let remaining = initialSize;
      for (let i = 0; i < numPages; i++) {
        const size = Math.min(remaining, _PagedBuffer.PAGE_SIZE);
        this.pages[i] = Buffer.allocUnsafe(size);
        remaining -= size;
      }
      this.singlePage = numPages === 1 ? this.pages[0] : null;
    }
    getSinglePage() {
      return this.singlePage;
    }
    get length() {
      return this._length;
    }
    static allocUnsafe(size) {
      return new _PagedBuffer(size);
    }
    resize(newSize) {
      if (newSize === this._length) return;
      const oldPages = this.pages;
      const numPages = Math.ceil(newSize / _PagedBuffer.PAGE_SIZE);
      this.pages = new Array(numPages);
      this._length = newSize;
      let remaining = newSize;
      for (let i = 0; i < numPages; i++) {
        const size = Math.min(remaining, _PagedBuffer.PAGE_SIZE);
        if (i < oldPages.length) {
          if (oldPages[i].length >= size) {
            this.pages[i] = oldPages[i].subarray(0, size);
          } else {
            const newPage = Buffer.allocUnsafe(size);
            oldPages[i].copy(newPage);
            this.pages[i] = newPage;
          }
        } else {
          this.pages[i] = Buffer.allocUnsafe(size);
        }
        remaining -= size;
      }
      this.singlePage = numPages === 1 ? this.pages[0] : null;
    }
    readUInt8(offset) {
      if (this.singlePage) return this.singlePage.readUInt8(offset);
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      return this.pages[pageIdx].readUInt8(pageOffset);
    }
    writeUInt8(value, offset) {
      if (this.singlePage) {
        this.singlePage.writeUInt8(value, offset);
        return;
      }
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      this.pages[pageIdx].writeUInt8(value, pageOffset);
    }
    readInt32LE(offset) {
      if (this.singlePage) return this.singlePage.readInt32LE(offset);
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      if (pageOffset + 4 <= _PagedBuffer.PAGE_SIZE) {
        return this.pages[pageIdx].readInt32LE(pageOffset);
      }
      return this.readMultiByte(offset, 4).readInt32LE(0);
    }
    writeInt32LE(value, offset) {
      if (this.singlePage) {
        this.singlePage.writeInt32LE(value, offset);
        return;
      }
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      if (pageOffset + 4 <= _PagedBuffer.PAGE_SIZE) {
        this.pages[pageIdx].writeInt32LE(value, pageOffset);
        return;
      }
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32LE(value, 0);
      this.writeMultiByte(buf, offset);
    }
    readUInt32LE(offset) {
      if (this.singlePage) return this.singlePage.readUInt32LE(offset);
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      if (pageOffset + 4 <= _PagedBuffer.PAGE_SIZE) {
        return this.pages[pageIdx].readUInt32LE(pageOffset);
      }
      return this.readMultiByte(offset, 4).readUInt32LE(0);
    }
    writeUInt32LE(value, offset) {
      if (this.singlePage) {
        this.singlePage.writeUInt32LE(value, offset);
        return;
      }
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      if (pageOffset + 4 <= _PagedBuffer.PAGE_SIZE) {
        this.pages[pageIdx].writeUInt32LE(value, pageOffset);
        return;
      }
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt32LE(value, 0);
      this.writeMultiByte(buf, offset);
    }
    // Helper for cross-boundary reads
    readMultiByte(offset, length) {
      const res = Buffer.allocUnsafe(length);
      this.copy(res, 0, offset, offset + length);
      return res;
    }
    // Helper for cross-boundary writes
    writeMultiByte(buf, offset) {
      let currentOffset = offset;
      let bufOffset = 0;
      let remaining = buf.length;
      while (remaining > 0) {
        const pageIdx = Math.floor(currentOffset / _PagedBuffer.PAGE_SIZE);
        const pageOffset = currentOffset % _PagedBuffer.PAGE_SIZE;
        const toWrite = Math.min(remaining, _PagedBuffer.PAGE_SIZE - pageOffset);
        buf.copy(this.pages[pageIdx], pageOffset, bufOffset, bufOffset + toWrite);
        currentOffset += toWrite;
        bufOffset += toWrite;
        remaining -= toWrite;
      }
    }
    copy(target, targetStart, sourceStart, sourceEnd) {
      if (this.singlePage) {
        return this.singlePage.copy(
          target,
          targetStart,
          sourceStart,
          sourceEnd
        );
      }
      let currentSource = sourceStart;
      let currentTarget = targetStart;
      let remaining = sourceEnd - sourceStart;
      const total = remaining;
      while (remaining > 0) {
        const pageIdx = Math.floor(currentSource / _PagedBuffer.PAGE_SIZE);
        const pageOffset = currentSource % _PagedBuffer.PAGE_SIZE;
        const toCopy = Math.min(remaining, _PagedBuffer.PAGE_SIZE - pageOffset);
        this.pages[pageIdx].copy(
          target,
          currentTarget,
          pageOffset,
          pageOffset + toCopy
        );
        currentSource += toCopy;
        currentTarget += toCopy;
        remaining -= toCopy;
      }
      return total;
    }
    // Special copy method for resizing (PagedBuffer -> PagedBuffer)
    copyToPaged(target, targetStart, sourceStart, sourceEnd) {
      let currentSource = sourceStart;
      let currentTarget = targetStart;
      let remaining = sourceEnd - sourceStart;
      while (remaining > 0) {
        const srcPageIdx = Math.floor(currentSource / _PagedBuffer.PAGE_SIZE);
        const srcPageOffset = currentSource % _PagedBuffer.PAGE_SIZE;
        const tgtPageIdx = Math.floor(currentTarget / _PagedBuffer.PAGE_SIZE);
        const tgtPageOffset = currentTarget % _PagedBuffer.PAGE_SIZE;
        const toCopy = Math.min(
          remaining,
          _PagedBuffer.PAGE_SIZE - srcPageOffset,
          _PagedBuffer.PAGE_SIZE - tgtPageOffset
        );
        this.pages[srcPageIdx].copy(
          target.pages[tgtPageIdx],
          tgtPageOffset,
          srcPageOffset,
          srcPageOffset + toCopy
        );
        currentSource += toCopy;
        currentTarget += toCopy;
        remaining -= toCopy;
      }
    }
    compare(target, targetStart, targetEnd, sourceStart, sourceEnd) {
      if (this.singlePage) {
        return this.singlePage.compare(
          target,
          targetStart,
          targetEnd,
          sourceStart,
          sourceEnd
        );
      }
      const len = sourceEnd - sourceStart;
      const targetLen = targetEnd - targetStart;
      if (len !== targetLen) return len - targetLen;
      let currentSource = sourceStart;
      let currentTarget = targetStart;
      let remaining = len;
      while (remaining > 0) {
        const pageIdx = Math.floor(currentSource / _PagedBuffer.PAGE_SIZE);
        const pageOffset = currentSource % _PagedBuffer.PAGE_SIZE;
        const toCheck = Math.min(remaining, _PagedBuffer.PAGE_SIZE - pageOffset);
        const res = this.pages[pageIdx].compare(
          target,
          currentTarget,
          currentTarget + toCheck,
          pageOffset,
          pageOffset + toCheck
        );
        if (res !== 0) return res;
        currentSource += toCheck;
        currentTarget += toCheck;
        remaining -= toCheck;
      }
      return 0;
    }
    // For direct writing of buffers (keys/values)
    writeBuffer(buf, offset) {
      if (this.singlePage) {
        buf.copy(this.singlePage, offset);
        return;
      }
      this.writeMultiByte(buf, offset);
    }
    // For reading buffers (decoding)
    readBuffer(offset, length) {
      if (this.singlePage) {
        return this.singlePage.subarray(offset, offset + length);
      }
      const pageIdx = Math.floor(offset / _PagedBuffer.PAGE_SIZE);
      const pageOffset = offset % _PagedBuffer.PAGE_SIZE;
      if (pageOffset + length <= _PagedBuffer.PAGE_SIZE) {
        return this.pages[pageIdx].subarray(pageOffset, pageOffset + length);
      }
      return this.readMultiByte(offset, length);
    }
  };

  // src/RogueMap.ts
  var DEFAULT_CAPACITY = 16384;
  var DEFAULT_MEMORY = 10 * 1024 * 1024;
  var FLAG_ACTIVE = 1;
  var FLAG_DELETED = 2;
  var RogueMap = class _RogueMap {
    capacity;
    capacityMask;
    // Optimization: mask for modulo operations (capacity - 1)
    buffer;
    rawBuffer = null;
    // Optimization: Direct access for single-page buffers
    buckets;
    // Changed to Float64Array to support >2GB offsets
    hashes;
    states;
    writeOffset;
    _size = 0;
    _deletedCount = 0;
    keyCodec;
    valueCodec;
    hasher;
    persistence;
    compaction;
    adapter;
    saveTimer;
    cache;
    cacheSize;
    tempKeyBuffer = Buffer.allocUnsafe(1024);
    // Reusable buffer for key comparison
    /**
     * Creates a new RogueMap instance.
     *
     * @param options Configuration options
     */
    constructor(options = {}) {
      let cap = options.capacity || DEFAULT_CAPACITY;
      if ((cap & cap - 1) !== 0) {
        cap = Math.pow(2, Math.ceil(Math.log2(cap)));
      }
      this.capacity = cap;
      this.capacityMask = cap - 1;
      this.buckets = new Float64Array(this.capacity);
      this.hashes = new Int32Array(this.capacity);
      this.states = new Uint8Array(this.capacity);
      this.buffer = PagedBuffer.allocUnsafe(
        options.initialMemory || DEFAULT_MEMORY
      );
      this.rawBuffer = this.buffer.getSinglePage();
      this.writeOffset = 1;
      this.keyCodec = options.keyCodec || AnyCodec;
      this.valueCodec = options.valueCodec || AnyCodec;
      this.cacheSize = options.cacheSize || 0;
      if (this.cacheSize > 0) {
        this.cache = /* @__PURE__ */ new Map();
      }
      if (options.hasher) {
        this.hasher = options.hasher;
      } else {
        this.hasher = (key) => {
          if (typeof key === "string") return fnv1a(key);
          if (typeof key === "number") return numberHash(key);
          if (Buffer.isBuffer(key)) return fnv1a(key.toString("binary"));
          return fnv1a(String(key));
        };
      }
      this.persistence = options.persistence;
      this.compaction = {
        autoCompact: true,
        threshold: 0.3,
        minSize: 1e3,
        ...options.compaction
      };
      if (this.persistence) {
        this.adapter = PersistenceManager.getAdapter(this.persistence.type);
        if (this.persistence.syncLoad !== false) {
          try {
            const savedData = this.adapter.loadSync(this.persistence.path);
            if (savedData) {
              this.loadFromBuffer(savedData);
            }
          } catch (e) {
          }
        }
        if (this.persistence.saveInterval && this.persistence.saveInterval > 0) {
          this.saveTimer = setInterval(
            () => this.save(),
            this.persistence.saveInterval
          );
          if (typeof this.saveTimer.unref === "function") {
            this.saveTimer.unref();
          }
        }
      }
    }
    /**
     * Initialize persistence asynchronously.
     * Required for environments like IndexedDB where synchronous access is not possible.
     * Loads the map state from the configured persistence storage.
     */
    async init() {
      if (!this.persistence || !this.adapter) return;
      const savedData = await this.adapter.load(this.persistence.path);
      if (savedData) {
        this.loadFromBuffer(savedData);
      }
    }
    /**
     * Manually save the map state to the configured persistence storage.
     * Note: Auto-save can also be configured via options.
     */
    async save() {
      if (!this.persistence || !this.adapter) return;
      const data = this.serialize();
      await this.adapter.save(data, this.persistence.path);
    }
    loadFromBuffer(data) {
      let cursor = 0;
      const magic = data.toString("utf8", cursor, cursor + 5);
      cursor += 5;
      if (magic !== "ROGUE") throw new Error("Invalid RogueMap format");
      const version = data.readUInt8(cursor);
      cursor += 1;
      if (version !== 1)
        throw new Error(`Unsupported RogueMap version: ${version}`);
      const capacity = data.readUInt32LE(cursor);
      cursor += 4;
      const size = data.readUInt32LE(cursor);
      cursor += 4;
      const writeOffset = data.readUInt32LE(cursor);
      cursor += 4;
      const bufferLength = data.readUInt32LE(cursor);
      cursor += 4;
      const bucketsSize = capacity * 4;
      const bucketsBuffer = data.subarray(cursor, cursor + bucketsSize);
      const alignedBucketsBuffer = Buffer.allocUnsafe(bucketsSize);
      bucketsBuffer.copy(alignedBucketsBuffer);
      const savedBuckets = new Float64Array(capacity);
      const tempInt32 = new Int32Array(
        alignedBucketsBuffer.buffer,
        alignedBucketsBuffer.byteOffset,
        bucketsSize / 4
      );
      for (let i = 0; i < capacity; i++) {
        savedBuckets[i] = tempInt32[i];
      }
      cursor += bucketsSize;
      this.capacity = capacity;
      this.capacityMask = capacity - 1;
      this.buckets = savedBuckets;
      this.hashes = new Int32Array(capacity);
      this.states = new Uint8Array(capacity);
      this._size = size;
      this.writeOffset = writeOffset;
      this.buffer = PagedBuffer.allocUnsafe(bufferLength);
      this.buffer.writeBuffer(data.subarray(cursor, cursor + bufferLength), 0);
      this.rawBuffer = this.buffer.getSinglePage();
      this._deletedCount = 0;
      for (let i = 0; i < this.capacity; i++) {
        const offset = this.buckets[i];
        if (offset !== 0) {
          const flag = this.buffer.readUInt8(offset);
          if (flag === FLAG_ACTIVE) {
            this.states[i] = FLAG_ACTIVE;
            const hash = this.buffer.readInt32LE(offset + 1);
            this.hashes[i] = hash;
          } else if (flag === FLAG_DELETED) {
            this.states[i] = FLAG_DELETED;
            const hash = this.buffer.readInt32LE(offset + 1);
            this.hashes[i] = hash;
          }
        }
      }
    }
    /**
     * Returns the number of elements in the map.
     */
    get size() {
      return this._size;
    }
    /**
     * Sets the value for the key in the map.
     *
     * @param key The key of the element to add to the RogueMap object.
     * @param value The value of the element to add to the RogueMap object.
     */
    set(key, value) {
      if (this.cache) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
          this.cache.set(key, value);
        } else {
          if (this.cache.size >= this.cacheSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== void 0) this.cache.delete(oldestKey);
          }
          this.cache.set(key, value);
        }
      }
      if (this._size >= this.capacity * 0.75) {
        this.resize(this.capacity * 2, this.buffer.length * 2);
      }
      const hash = this.hasher(key) | 0;
      try {
        this.put(key, value, hash);
      } catch (e) {
        if (e.message === "RogueMap: Out of memory (Buffer full)") {
          let retries = 0;
          while (retries < 3) {
            this.resize(this.capacity, this.buffer.length * 2);
            try {
              this.put(key, value, hash);
              break;
            } catch (retryErr) {
              if (retryErr.message === "RogueMap: Out of memory (Buffer full)") {
                retries++;
                continue;
              }
              throw retryErr;
            }
          }
          if (retries === 3) throw e;
        } else if (e.message === "RogueMap: Hash table full") {
          this.resize(this.capacity * 2, this.buffer.length * 2);
          this.put(key, value, hash);
        } else {
          throw e;
        }
      }
      this.checkCompaction();
    }
    put(key, value, hash) {
      const buckets = this.buckets;
      const states = this.states;
      const hashes = this.hashes;
      const mask = this.capacityMask;
      const keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2)
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      let index = Math.abs(hash) & mask;
      const start_index = index;
      let tombstoneIndex = -1;
      if (this.rawBuffer) {
        const raw = this.rawBuffer;
        const tempKey = this.tempKeyBuffer;
        const keyFixed = this.keyCodec.fixedLength;
        const valFixed = this.valueCodec.fixedLength;
        while (true) {
          const offset = buckets[index];
          if (offset === 0) {
            if (tombstoneIndex !== -1) {
              index = tombstoneIndex;
            }
            const valLen = this.valueCodec.byteLength(value);
            let entrySize = 5;
            if (keyFixed === void 0) entrySize += 4;
            if (valFixed === void 0) entrySize += 4;
            entrySize += keyLen + valLen;
            if (this.writeOffset + entrySize > raw.length) {
              throw new Error("RogueMap: Out of memory (Buffer full)");
            }
            let cursor = this.writeOffset;
            raw[cursor++] = FLAG_ACTIVE;
            raw[cursor] = hash & 255;
            raw[cursor + 1] = hash >>> 8 & 255;
            raw[cursor + 2] = hash >>> 16 & 255;
            raw[cursor + 3] = hash >>> 24 & 255;
            cursor += 4;
            if (keyFixed === void 0) {
              raw[cursor] = keyLen & 255;
              raw[cursor + 1] = keyLen >>> 8 & 255;
              raw[cursor + 2] = keyLen >>> 16 & 255;
              raw[cursor + 3] = keyLen >>> 24 & 255;
              cursor += 4;
            }
            if (valFixed === void 0) {
              raw[cursor] = valLen & 255;
              raw[cursor + 1] = valLen >>> 8 & 255;
              raw[cursor + 2] = valLen >>> 16 & 255;
              raw[cursor + 3] = valLen >>> 24 & 255;
              cursor += 4;
            }
            if (keyLen > 0) {
              tempKey.copy(raw, cursor, 0, keyLen);
              cursor += keyLen;
            }
            if (valLen > 0) {
              this.valueCodec.encode(value, raw, cursor);
              cursor += valLen;
            }
            this.buckets[index] = this.writeOffset;
            this.hashes[index] = hash;
            this.states[index] = FLAG_ACTIVE;
            this.writeOffset += entrySize;
            this._size++;
            return;
          }
          const state = states[index];
          if (state === FLAG_DELETED) {
            if (tombstoneIndex === -1) tombstoneIndex = index;
          } else if (state === FLAG_ACTIVE) {
            if (hashes[index] === hash) {
              let cursor = offset + 5;
              let storedKeyLen = keyLen;
              if (keyFixed === void 0) {
                storedKeyLen = raw[cursor] | raw[cursor + 1] << 8 | raw[cursor + 2] << 16 | raw[cursor + 3] << 24;
                cursor += 4;
              }
              if (valFixed === void 0) {
                cursor += 4;
              }
              if (storedKeyLen === keyLen) {
                let match = true;
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  raw[offset] = FLAG_DELETED;
                  states[index] = FLAG_DELETED;
                  this._deletedCount++;
                  const valLen = this.valueCodec.byteLength(value);
                  let entrySize = 5;
                  if (keyFixed === void 0) entrySize += 4;
                  if (valFixed === void 0) entrySize += 4;
                  entrySize += keyLen + valLen;
                  if (this.writeOffset + entrySize > raw.length) {
                    throw new Error("RogueMap: Out of memory (Buffer full)");
                  }
                  let wCursor = this.writeOffset;
                  raw[wCursor++] = FLAG_ACTIVE;
                  raw[wCursor] = hash & 255;
                  raw[wCursor + 1] = hash >>> 8 & 255;
                  raw[wCursor + 2] = hash >>> 16 & 255;
                  raw[wCursor + 3] = hash >>> 24 & 255;
                  wCursor += 4;
                  if (keyFixed === void 0) {
                    raw[wCursor] = keyLen & 255;
                    raw[wCursor + 1] = keyLen >>> 8 & 255;
                    raw[wCursor + 2] = keyLen >>> 16 & 255;
                    raw[wCursor + 3] = keyLen >>> 24 & 255;
                    wCursor += 4;
                  }
                  if (valFixed === void 0) {
                    raw[wCursor] = valLen & 255;
                    raw[wCursor + 1] = valLen >>> 8 & 255;
                    raw[wCursor + 2] = valLen >>> 16 & 255;
                    raw[wCursor + 3] = valLen >>> 24 & 255;
                    wCursor += 4;
                  }
                  if (keyLen > 0) {
                    tempKey.copy(raw, wCursor, 0, keyLen);
                    wCursor += keyLen;
                  }
                  if (valLen > 0) {
                    this.valueCodec.encode(value, raw, wCursor);
                    wCursor += valLen;
                  }
                  this.buckets[index] = this.writeOffset;
                  this.hashes[index] = hash;
                  this.states[index] = FLAG_ACTIVE;
                  this.writeOffset += entrySize;
                  return;
                }
              }
            }
          }
          index = index + 1 & mask;
          if (index === start_index) {
            throw new Error("RogueMap: Hash table full");
          }
        }
      }
      while (true) {
        const offset = buckets[index];
        if (offset === 0) {
          if (tombstoneIndex !== -1) {
            index = tombstoneIndex;
          }
          this.writeEntry(index, key, value, hash);
          this._size++;
          return;
        }
        const state = states[index];
        if (state === FLAG_DELETED) {
          if (tombstoneIndex === -1) tombstoneIndex = index;
        } else if (state === FLAG_ACTIVE) {
          if (hashes[index] === hash) {
            if (this.keyMatchesPreEncoded(offset, keyLen)) {
              this.buffer.writeUInt8(FLAG_DELETED, offset);
              states[index] = FLAG_DELETED;
              this._deletedCount++;
              this.writeEntry(index, key, value, hash);
              return;
            }
          }
        }
        index = index + 1 & mask;
        if (index === start_index) {
          throw new Error("RogueMap: Hash table full");
        }
      }
    }
    checkCompaction() {
      if (!this.compaction.autoCompact) return;
      if (this._size + this._deletedCount < (this.compaction.minSize || 1e3))
        return;
      const ratio = this._deletedCount / (this._size + this._deletedCount);
      if (ratio > (this.compaction.threshold || 0.3)) {
        this.compact();
      }
    }
    resize(newCapacity, newMemory) {
      const oldBuffer = this.buffer;
      const oldLimit = this.writeOffset;
      if ((newCapacity & newCapacity - 1) !== 0) {
        newCapacity = Math.pow(2, Math.ceil(Math.log2(newCapacity)));
      }
      this.capacity = newCapacity;
      this.capacityMask = newCapacity - 1;
      this.buckets = new Float64Array(this.capacity);
      this.hashes = new Int32Array(this.capacity);
      this.states = new Uint8Array(this.capacity);
      this.buffer = PagedBuffer.allocUnsafe(newMemory);
      this.rawBuffer = this.buffer.getSinglePage();
      this.writeOffset = 1;
      this._size = 0;
      let cursor = 1;
      while (cursor < oldLimit) {
        const flag = oldBuffer.readUInt8(cursor);
        const hash = oldBuffer.readInt32LE(cursor + 1);
        let entryLen = 5;
        let keySize, valSize;
        let kLenSize = 0, vLenSize = 0;
        if (this.keyCodec.fixedLength !== void 0) {
          keySize = this.keyCodec.fixedLength;
        } else {
          keySize = oldBuffer.readInt32LE(cursor + 5);
          kLenSize = 4;
        }
        if (this.valueCodec.fixedLength !== void 0) {
          valSize = this.valueCodec.fixedLength;
        } else {
          valSize = oldBuffer.readInt32LE(cursor + 5 + kLenSize);
          vLenSize = 4;
        }
        entryLen += kLenSize + vLenSize + keySize + valSize;
        if (flag === FLAG_ACTIVE) {
          const keyStart = cursor + 5 + kLenSize + vLenSize;
          const keyBuf = oldBuffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);
          const valStart = keyStart + keySize;
          const valBuf = oldBuffer.readBuffer(valStart, valSize);
          const value = this.valueCodec.decode(valBuf, 0, valSize);
          this.put(key, value, hash);
        }
        cursor += entryLen;
      }
    }
    /**
     * Compacts the map by removing deleted entries and resizing the buffer to fit the active data.
     * This is useful to reclaim memory after many deletions.
     */
    compact() {
      let requiredSize = 1;
      let cursor = 1;
      while (cursor < this.writeOffset) {
        const flag = this.buffer.readUInt8(cursor);
        let entryLen = 5;
        let keySize, valSize;
        let kLenSize = 0, vLenSize = 0;
        if (this.keyCodec.fixedLength !== void 0) {
          keySize = this.keyCodec.fixedLength;
        } else {
          keySize = this.buffer.readInt32LE(cursor + 5);
          kLenSize = 4;
        }
        if (this.valueCodec.fixedLength !== void 0) {
          valSize = this.valueCodec.fixedLength;
        } else {
          valSize = this.buffer.readInt32LE(cursor + 5 + kLenSize);
          vLenSize = 4;
        }
        const totalLen = entryLen + kLenSize + vLenSize + keySize + valSize;
        if (flag === FLAG_ACTIVE) {
          requiredSize += totalLen;
        }
        cursor += totalLen;
      }
      const newBufferSize = Math.max(requiredSize * 1.2, 1024);
      this.resize(this.capacity, newBufferSize);
      this._deletedCount = 0;
      if (this.persistence && this.adapter) {
        this.save().catch(console.error);
      }
    }
    /**
     * Serializes the map state into a Buffer.
     * The returned buffer contains the full state of the map and can be saved to disk or transmitted.
     * Use RogueMap.deserialize() to restore the map from this buffer.
     */
    serialize() {
      const headerSize = 5 + 1 + 4 + 4 + 4 + 4;
      const bucketsSize = this.capacity * 4;
      const bufferSize = this.writeOffset;
      const totalSize = headerSize + bucketsSize + bufferSize;
      if (totalSize > 2 * 1024 * 1024 * 1024) {
      }
      const result = Buffer.allocUnsafe(totalSize);
      let cursor = 0;
      result.write("ROGUE", cursor);
      cursor += 5;
      result.writeUInt8(1, cursor);
      cursor += 1;
      result.writeUInt32LE(this.capacity, cursor);
      cursor += 4;
      result.writeUInt32LE(this._size, cursor);
      cursor += 4;
      result.writeUInt32LE(this.writeOffset, cursor);
      cursor += 4;
      result.writeUInt32LE(bufferSize, cursor);
      cursor += 4;
      const tempInt32 = new Int32Array(this.capacity);
      for (let i = 0; i < this.capacity; i++) tempInt32[i] = this.buckets[i];
      const bucketsBuffer = Buffer.from(
        tempInt32.buffer,
        tempInt32.byteOffset,
        tempInt32.byteLength
      );
      bucketsBuffer.copy(result, cursor);
      cursor += bucketsSize;
      this.buffer.copy(result, cursor, 0, bufferSize);
      return result;
    }
    /**
     * Creates a new RogueMap instance from a serialized buffer.
     *
     * @param data The buffer containing the serialized map data.
     * @param options Configuration options for the new instance.
     */
    static deserialize(data, options = {}) {
      const map = new _RogueMap(options);
      map.loadFromBuffer(data);
      return map;
    }
    /**
     * Returns the value associated to the key, or undefined if there is none.
     *
     * @param key The key of the element to return.
     */
    get(key) {
      if (this.cache) {
        const val = this.cache.get(key);
        if (val !== void 0) {
          this.cache.delete(key);
          this.cache.set(key, val);
          return val;
        }
      }
      const hash = this.hasher(key) | 0;
      const buckets = this.buckets;
      const states = this.states;
      const hashes = this.hashes;
      const mask = this.capacityMask;
      let index = Math.abs(hash) & mask;
      let start_index = index;
      const keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2)
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      if (this.rawBuffer) {
        const raw = this.rawBuffer;
        const tempKey = this.tempKeyBuffer;
        const keyFixed = this.keyCodec.fixedLength;
        const valFixed = this.valueCodec.fixedLength;
        while (true) {
          const offset = buckets[index];
          if (offset === 0) return void 0;
          if (states[index] === FLAG_ACTIVE) {
            if (hashes[index] === hash) {
              let cursor = offset + 5;
              let storedKeyLen = keyLen;
              if (keyFixed === void 0) {
                storedKeyLen = raw[cursor] | raw[cursor + 1] << 8 | raw[cursor + 2] << 16 | raw[cursor + 3] << 24;
                cursor += 4;
              }
              if (valFixed === void 0) {
                cursor += 4;
              }
              if (storedKeyLen === keyLen) {
                let match = true;
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  let vCursor = offset + 5;
                  if (keyFixed === void 0) vCursor += 4;
                  let valLen;
                  if (valFixed !== void 0) {
                    valLen = valFixed;
                  } else {
                    valLen = raw[vCursor] | raw[vCursor + 1] << 8 | raw[vCursor + 2] << 16 | raw[vCursor + 3] << 24;
                    vCursor += 4;
                  }
                  vCursor += keyLen;
                  const valBuf = raw.subarray(vCursor, vCursor + valLen);
                  const val = this.valueCodec.decode(valBuf, 0, valLen);
                  if (this.cache) {
                    if (this.cache.size >= this.cacheSize) {
                      const oldestKey = this.cache.keys().next().value;
                      if (oldestKey !== void 0) this.cache.delete(oldestKey);
                    }
                    this.cache.set(key, val);
                  }
                  return val;
                }
              }
            }
          }
          index = index + 1 & mask;
          if (index === start_index) return void 0;
        }
      }
      while (true) {
        const offset = buckets[index];
        if (offset === 0) return void 0;
        if (states[index] === FLAG_ACTIVE) {
          if (hashes[index] === hash) {
            if (this.keyMatchesPreEncoded(offset, keyLen)) {
              const val = this.readValue(offset);
              if (this.cache) {
                if (this.cache.size >= this.cacheSize) {
                  const oldestKey = this.cache.keys().next().value;
                  if (oldestKey !== void 0) this.cache.delete(oldestKey);
                }
                this.cache.set(key, val);
              }
              return val;
            }
          }
        }
        index = index + 1 & mask;
        if (index === start_index) return void 0;
      }
    }
    /**
     * Returns a boolean asserting whether a value has been associated to the key in the RogueMap object or not.
     *
     * @param key The key of the element to test for presence.
     */
    has(key) {
      const hash = this.hasher(key) | 0;
      const buckets = this.buckets;
      const states = this.states;
      const hashes = this.hashes;
      const mask = this.capacityMask;
      let index = Math.abs(hash) & mask;
      let start_index = index;
      const keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2)
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      if (this.rawBuffer) {
        const raw = this.rawBuffer;
        const tempKey = this.tempKeyBuffer;
        const keyFixed = this.keyCodec.fixedLength;
        const valFixed = this.valueCodec.fixedLength;
        while (true) {
          const offset = buckets[index];
          if (offset === 0) return false;
          if (states[index] === FLAG_ACTIVE) {
            if (hashes[index] === hash) {
              let cursor = offset + 5;
              let storedKeyLen = keyLen;
              if (keyFixed === void 0) {
                storedKeyLen = raw[cursor] | raw[cursor + 1] << 8 | raw[cursor + 2] << 16 | raw[cursor + 3] << 24;
                cursor += 4;
              }
              if (valFixed === void 0) cursor += 4;
              if (storedKeyLen === keyLen) {
                let match = true;
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  return true;
                }
              }
            }
          }
          index = index + 1 & mask;
          if (index === start_index) return false;
        }
      }
      while (true) {
        const offset = buckets[index];
        if (offset === 0) return false;
        if (states[index] === FLAG_ACTIVE) {
          if (hashes[index] === hash) {
            if (this.keyMatchesPreEncoded(offset, keyLen)) return true;
          }
        }
        index = index + 1 & mask;
        if (index === start_index) return false;
      }
    }
    /**
     * Removes the specified element from the RogueMap object.
     * Returns true if an element in the RogueMap object existed and has been removed, or false if the element does not exist.
     *
     * @param key The key of the element to remove.
     */
    delete(key) {
      if (this.cache) {
        this.cache.delete(key);
      }
      const hash = this.hasher(key) | 0;
      const buckets = this.buckets;
      const states = this.states;
      const hashes = this.hashes;
      const mask = this.capacityMask;
      let index = Math.abs(hash) & mask;
      let start_index = index;
      const keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2)
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      if (this.rawBuffer) {
        const raw = this.rawBuffer;
        const tempKey = this.tempKeyBuffer;
        const keyFixed = this.keyCodec.fixedLength;
        const valFixed = this.valueCodec.fixedLength;
        while (true) {
          const offset = buckets[index];
          if (offset === 0) return false;
          if (states[index] === FLAG_ACTIVE) {
            if (hashes[index] === hash) {
              let cursor = offset + 5;
              let storedKeyLen = keyLen;
              if (keyFixed === void 0) {
                storedKeyLen = raw[cursor] | raw[cursor + 1] << 8 | raw[cursor + 2] << 16 | raw[cursor + 3] << 24;
                cursor += 4;
              }
              if (valFixed === void 0) cursor += 4;
              if (storedKeyLen === keyLen) {
                let match = true;
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  raw[offset] = FLAG_DELETED;
                  states[index] = FLAG_DELETED;
                  this._size--;
                  this._deletedCount++;
                  this.checkCompaction();
                  return true;
                }
              }
            }
          }
          index = index + 1 & mask;
          if (index === start_index) return false;
        }
      }
      while (true) {
        const offset = buckets[index];
        if (offset === 0) return false;
        if (states[index] === FLAG_ACTIVE) {
          if (hashes[index] === hash) {
            if (this.keyMatchesPreEncoded(offset, keyLen)) {
              this.buffer.writeUInt8(FLAG_DELETED, offset);
              states[index] = FLAG_DELETED;
              this._size--;
              this._deletedCount++;
              this.checkCompaction();
              return true;
            }
          }
        }
        index = index + 1 & mask;
        if (index === start_index) return false;
      }
    }
    /**
     * Removes all elements from the RogueMap object.
     */
    clear() {
      if (this.cache) {
        this.cache.clear();
      }
      this.buckets.fill(0);
      this.hashes.fill(0);
      this.states.fill(0);
      this.writeOffset = 1;
      this._size = 0;
      this._deletedCount = 0;
    }
    writeEntry(index, key, value, hash) {
      const keySize = this.keyCodec.byteLength(key);
      const valSize = this.valueCodec.byteLength(value);
      const keyFixed = this.keyCodec.fixedLength !== void 0;
      const valFixed = this.valueCodec.fixedLength !== void 0;
      let entrySize = 5;
      if (!keyFixed) entrySize += 4;
      if (!valFixed) entrySize += 4;
      entrySize += keySize + valSize;
      if (this.writeOffset + entrySize > this.buffer.length) {
        throw new Error("RogueMap: Out of memory (Buffer full)");
      }
      const offset = this.writeOffset;
      let cursor = offset;
      this.buffer.writeUInt8(FLAG_ACTIVE, cursor);
      cursor += 1;
      this.buffer.writeInt32LE(hash, cursor);
      cursor += 4;
      if (!keyFixed) {
        this.buffer.writeInt32LE(keySize, cursor);
        cursor += 4;
      }
      if (!valFixed) {
        this.buffer.writeInt32LE(valSize, cursor);
        cursor += 4;
      }
      if (keySize > 0) {
        const keyBuf = Buffer.allocUnsafe(keySize);
        this.keyCodec.encode(key, keyBuf, 0);
        this.buffer.writeBuffer(keyBuf, cursor);
        cursor += keySize;
      }
      if (valSize > 0) {
        const valBuf = Buffer.allocUnsafe(valSize);
        this.valueCodec.encode(value, valBuf, 0);
        this.buffer.writeBuffer(valBuf, cursor);
        cursor += valSize;
      }
      this.writeOffset += entrySize;
      this.buckets[index] = offset;
      this.hashes[index] = hash;
      this.states[index] = FLAG_ACTIVE;
    }
    keyMatchesPreEncoded(offset, keyLen) {
      let cursor = offset + 5;
      let keySize;
      if (this.keyCodec.fixedLength !== void 0) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor);
        cursor += 4;
      }
      if (this.valueCodec.fixedLength === void 0) {
        cursor += 4;
      }
      if (keyLen !== keySize) return false;
      return this.buffer.compare(
        this.tempKeyBuffer,
        0,
        keyLen,
        cursor,
        cursor + keySize
      ) === 0;
    }
    keyMatches(offset, key) {
      let cursor = offset + 5;
      let keySize;
      if (this.keyCodec.fixedLength !== void 0) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor);
        cursor += 4;
      }
      if (this.valueCodec.fixedLength === void 0) {
        cursor += 4;
      }
      const len = this.keyCodec.byteLength(key);
      if (len !== keySize) return false;
      if (len <= this.tempKeyBuffer.length) {
        this.keyCodec.encode(key, this.tempKeyBuffer, 0);
        return this.buffer.compare(
          this.tempKeyBuffer,
          0,
          len,
          cursor,
          cursor + keySize
        ) === 0;
      }
      const temp = Buffer.allocUnsafe(len);
      this.keyCodec.encode(key, temp, 0);
      return this.buffer.compare(temp, 0, len, cursor, cursor + keySize) === 0;
    }
    readValue(offset) {
      let cursor = offset + 5;
      let keySize;
      if (this.keyCodec.fixedLength !== void 0) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor);
        cursor += 4;
      }
      let valSize;
      if (this.valueCodec.fixedLength !== void 0) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = this.buffer.readInt32LE(cursor);
        cursor += 4;
      }
      cursor += keySize;
      const valBuf = this.buffer.readBuffer(cursor, valSize);
      return this.valueCodec.decode(valBuf, 0, valSize);
    }
    /**
     * Returns a new Iterator object that contains the [key, value] pairs for each element in the RogueMap object in insertion order.
     * Note: The order is based on internal buffer layout, which is roughly insertion order but affected by deletions and updates.
     */
    *entries() {
      let cursor = 1;
      while (cursor < this.writeOffset) {
        const flag = this.buffer.readUInt8(cursor);
        let entryLen = 5;
        let keySize, valSize;
        let kLenSize = 0, vLenSize = 0;
        if (this.keyCodec.fixedLength !== void 0) {
          keySize = this.keyCodec.fixedLength;
        } else {
          keySize = this.buffer.readInt32LE(cursor + 5);
          kLenSize = 4;
        }
        if (this.valueCodec.fixedLength !== void 0) {
          valSize = this.valueCodec.fixedLength;
        } else {
          valSize = this.buffer.readInt32LE(cursor + 5 + kLenSize);
          vLenSize = 4;
        }
        entryLen += kLenSize + vLenSize + keySize + valSize;
        if (flag === FLAG_ACTIVE) {
          const keyStart = cursor + 5 + kLenSize + vLenSize;
          const keyBuf = this.buffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);
          const valStart = keyStart + keySize;
          const valBuf = this.buffer.readBuffer(valStart, valSize);
          const value = this.valueCodec.decode(valBuf, 0, valSize);
          yield [key, value];
        }
        cursor += entryLen;
      }
    }
    /**
     * Returns a new Iterator object that contains the keys for each element in the RogueMap object.
     */
    *keys() {
      for (const [key] of this.entries()) {
        yield key;
      }
    }
    /**
     * Returns a new Iterator object that contains the values for each element in the RogueMap object.
     */
    *values() {
      for (const [_, value] of this.entries()) {
        yield value;
      }
    }
    /**
     * Returns a new Iterator object that contains the [key, value] pairs for each element in the RogueMap object.
     */
    [Symbol.iterator]() {
      return this.entries();
    }
    /**
     * Executes a provided function once per each key/value pair in the RogueMap object.
     *
     * @param callback Function to execute for each element.
     * @param thisArg Value to use as this when executing callback.
     */
    forEach(callback, thisArg) {
      for (const [key, value] of this.entries()) {
        callback.call(thisArg, value, key, this);
      }
    }
  };

  // benchmarks/browser/src/benchmark.ts
  var outputDiv = document.getElementById("output");
  var btnRun = document.getElementById("btnRun");
  function log(msg, type = "info") {
    const line = document.createElement("div");
    line.textContent = msg;
    if (type === "success") line.className = "success";
    if (type === "error") line.className = "error";
    outputDiv.appendChild(line);
    outputDiv.scrollTop = outputDiv.scrollHeight;
  }
  function clearLog() {
    outputDiv.innerHTML = "";
  }
  async function runBenchmark() {
    btnRun.disabled = true;
    clearLog();
    log("Starting benchmark...", "running");
    const countSelect = document.getElementById("itemCount");
    const COUNT = parseInt(countSelect.value, 10);
    try {
      log(`Initializing RogueMap with ${COUNT.toLocaleString()} items...`);
      log(`
--- In-Memory Performance ---`);
      const map = new RogueMap({
        capacity: COUNT * 1.5,
        initialMemory: COUNT * 64,
        // Pre-alloc to avoid resize noise
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
        persistence: { type: "indexeddb", path: "benchmark-db" }
      });
      const startSet = performance.now();
      for (let i = 0; i < COUNT; i++) {
        map.set(`key:${i}`, i);
      }
      const endSet = performance.now();
      log(`SET: ${(endSet - startSet).toFixed(2)}ms (${Math.round(COUNT / ((endSet - startSet) / 1e3))} ops/sec)`, "success");
      const startGet = performance.now();
      let sum = 0;
      for (let i = 0; i < COUNT; i++) {
        const val = map.get(`key:${i}`);
        if (val !== void 0) sum += val;
      }
      const endGet = performance.now();
      log(`GET: ${(endGet - startGet).toFixed(2)}ms (${Math.round(COUNT / ((endGet - startGet) / 1e3))} ops/sec)`, "success");
      log(`
--- Persistence (IndexedDB) ---`);
      log(`Saving to IndexedDB... (This is async)`);
      const startSave = performance.now();
      await map.save();
      const endSave = performance.now();
      log(`SAVE: ${(endSave - startSave).toFixed(2)}ms`, "success");
      log(`Clearing memory and reloading...`);
      const map2 = new RogueMap({
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
        persistence: { type: "indexeddb", path: "benchmark-db" }
      });
      const startLoad = performance.now();
      await map2.init();
      const endLoad = performance.now();
      log(`LOAD: ${(endLoad - startLoad).toFixed(2)}ms`, "success");
      log(`Map size after load: ${map2.size}`);
      if (map2.size !== COUNT) {
        log(`ERROR: Size mismatch! Expected ${COUNT}, got ${map2.size}`, "error");
      } else {
        log(`Verification passed.`, "success");
      }
    } catch (e) {
      log(`Error: ${e.message}`, "error");
      console.error(e);
    } finally {
      btnRun.disabled = false;
    }
  }
  async function clearData() {
    try {
      const req = indexedDB.deleteDatabase("RogueMapDB");
      req.onsuccess = () => {
        log("Database cleared.", "success");
      };
      req.onerror = () => {
        log("Failed to clear database.", "error");
      };
    } catch (e) {
      log("Error clearing: " + e);
    }
  }
  window.runBenchmark = runBenchmark;
  window.clearData = clearData;
})();
//# sourceMappingURL=benchmark.bundle.js.map
