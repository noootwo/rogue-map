import { Codec } from "./interfaces";
import { AnyCodec } from "./codecs";
import { murmurHash3, numberHash } from "./utils";
import { EventEmitter } from "events";
import {
  PersistenceOptions,
  CompactionOptions,
  PersistenceAdapter,
} from "./persistence/interfaces";
import { PersistenceManager } from "./persistence/manager";
import { PagedBuffer } from "./PagedBuffer";
import { Buffer } from "./internal/buffer";

/**
 * Configuration options for creating a RogueMap instance.
 */
export interface RogueMapOptions<K, V> {
  /**
   * Initial capacity of the hash table (number of buckets).
   * Defaults to 16384.
   */
  capacity?: number;
  /**
   * Initial size of the off-heap buffer in bytes.
   * Defaults to 10MB.
   */
  initialMemory?: number;
  /**
   * Codec for encoding/decoding keys.
   * Defaults to StringCodec.
   */
  keyCodec?: Codec<K>;
  /**
   * Codec for encoding/decoding values.
   * Defaults to JSONCodec.
   */
  valueCodec?: Codec<V>;
  /**
   * Custom hash function for keys.
   * Defaults to FNV1a for strings.
   */
  hasher?: (key: K) => number;
  /**
   * Configuration for persistence (saving/loading to disk/storage).
   */
  persistence?: PersistenceOptions;
  /**
   * Configuration for auto-compaction (garbage collection of deleted items).
   */
  compaction?: CompactionOptions;
  /**
   * Size of the LRU Cache for hot items (number of items).
   * Set to 0 to disable. Defaults to 0.
   */
  cacheSize?: number; // LRU Cache size (0 = disabled)
  /**
   * Default Time-To-Live (TTL) for entries in milliseconds.
   * If set, entries will expire after this duration.
   * Can be overridden per-entry in set().
   */
  ttl?: number;
}

/**
 * Options for set() method.
 */
export interface SetOptions {
  /**
   * Time-To-Live (TTL) for this entry in milliseconds.
   * Overrides the default TTL if set.
   */
  ttl?: number;
}

const DEFAULT_CAPACITY = 16384;
const DEFAULT_MEMORY = 10 * 1024 * 1024; // 10MB
const FLAG_ACTIVE = 1;
const FLAG_DELETED = 2;
// 8 bytes for TTL (ExpireAt) in Entry Header
// Layout: [Flag(1)] [Hash(4)] [ExpireAt(8)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
// ExpireAt = 0 means no expiration (or very old format, but we init with 0 for no expiry)
// Wait, 0 is 1970. We should use 0 to mean "persist".
// If we use 0 as "no expiry", then expired check is: if (expireAt > 0 && now > expireAt).
const TTL_SIZE = 8;
const ENTRY_HEADER_SIZE_V1 = 5; // Flag(1) + Hash(4)
const ENTRY_HEADER_SIZE_V2 = 13; // Flag(1) + Hash(4) + ExpireAt(8)
// We need to detect version or force V2.
// For simplicity in this iteration, we upgrade to V2 layout by default.
// But this breaks persistence compatibility with V1 files.
// We can bump version in serialize().

/**
 * RogueMap: A high-performance, off-heap hash map for Node.js.
 *
 * Stores data in a Node.js Buffer to reduce GC overhead and heap usage.
 * Supports custom codecs, persistence, and an optional LRU cache for hot reads.
 *
 * @template K Type of keys (must be supported by keyCodec)
 * @template V Type of values (must be supported by valueCodec)
 */
export class RogueMap<K = any, V = any> extends EventEmitter {
  private capacity: number;
  private capacityMask: number; // Optimization: mask for modulo operations (capacity - 1)
  private buffer: PagedBuffer;
  private rawBuffer: Buffer | null = null; // Optimization: Direct access for single-page buffers
  // Compact Layout:
  // _hashes: Int32Array (4 bytes per slot)
  // _offsets: Float64Array (8 bytes per slot)
  // Index i corresponds to the same bucket in both arrays.
  private _hashes: Int32Array;
  private _offsets: Float64Array;
  private writeOffset: number;
  private _size: number = 0;
  private _deletedCount: number = 0;

  private keyCodec: Codec<K>;
  private valueCodec: Codec<V>;
  private hasher: (key: K) => number;

  private persistence?: PersistenceOptions;
  private compaction: CompactionOptions;
  private adapter?: PersistenceAdapter;
  private saveTimer?: NodeJS.Timeout | number;

  private cache?: Map<K, V>;
  private cacheSize: number;
  private defaultTTL: number;

  private tempKeyBuffer: Buffer = Buffer.allocUnsafe(1024); // Reusable buffer for key comparison

  /**
   * Creates a new RogueMap instance.
   *
   * @param options Configuration options
   */
  constructor(options: RogueMapOptions<K, V> = {}) {
    super();
    // Ensure capacity is power of 2 for fast modulo
    let cap = options.capacity || DEFAULT_CAPACITY;
    if ((cap & (cap - 1)) !== 0) {
      cap = Math.pow(2, Math.ceil(Math.log2(cap)));
    }
    this.capacity = cap;
    this.capacityMask = cap - 1;

    this._hashes = new Int32Array(this.capacity);
    this._offsets = new Float64Array(this.capacity);

    this.buffer = PagedBuffer.allocUnsafe(
      options.initialMemory || DEFAULT_MEMORY,
    );
    this.rawBuffer = this.buffer.getSinglePage();
    this.writeOffset = 1; // Start at 1 because 0 in buckets means empty

    // Default to AnyCodec for maximum flexibility if no codec is provided
    this.keyCodec = options.keyCodec || (AnyCodec as unknown as Codec<K>);
    this.valueCodec = options.valueCodec || (AnyCodec as unknown as Codec<V>);

    this.cacheSize = options.cacheSize || 0;
    if (this.cacheSize > 0) {
      this.cache = new Map();
    }

    this.defaultTTL = options.ttl || 0;

    if (options.hasher) {
      this.hasher = options.hasher;
    } else {
      // Default hasher inference
      this.hasher = (key: K) => {
        if (typeof key === "string") return murmurHash3(key);
        if (typeof key === "number") return numberHash(key);
        if (Buffer.isBuffer(key)) return murmurHash3(key);
        return murmurHash3(String(key));
      };
    }

    // Persistence & Compaction Setup
    this.persistence = options.persistence;
    this.compaction = {
      autoCompact: true,
      threshold: 0.3,
      minSize: 1000,
      ...options.compaction,
    };

    if (this.persistence) {
      this.adapter = PersistenceManager.getAdapter(this.persistence.type);

      // Try synchronous load if configured (Node.js default)
      if (this.persistence.syncLoad !== false) {
        try {
          const savedData = this.adapter.loadSync(this.persistence.path);
          if (savedData) {
            this.loadFromBuffer(savedData);
          }
        } catch (e: any) {
          // Ignore sync load errors if it's because method not implemented (browser)
          // But if syncLoad is explicitly true, we might want to throw?
          // For 'auto', we try and ignore.
        }
      }

      // Start auto-save timer
      if (this.persistence.saveInterval && this.persistence.saveInterval > 0) {
        this.saveTimer = setInterval(
          () => this.save(),
          this.persistence.saveInterval,
        );
        // Unref to not block process exit in Node
        if (typeof (this.saveTimer as any).unref === "function") {
          (this.saveTimer as any).unref();
        }
      }
    }
  }

  /**
   * Initialize persistence asynchronously.
   * Required for environments like IndexedDB where synchronous access is not possible.
   * Loads the map state from the configured persistence storage.
   */
  async init(): Promise<void> {
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
  async save(): Promise<void> {
    if (!this.persistence || !this.adapter) return;
    const data = this.serialize();
    await this.adapter.save(data, this.persistence.path);
  }

  private loadFromBuffer(data: Buffer) {
    // This logic is similar to deserialize but reuses the current instance
    // We assume data format is valid
    let cursor = 0;

    // Magic
    const magic = data.toString("utf8", cursor, cursor + 5);
    cursor += 5;
    if (magic !== "ROGUE") throw new Error("Invalid RogueMap format");

    // Version
    const version = data.readUInt8(cursor);
    cursor += 1;
    if (version !== 2)
      throw new Error(
        `Unsupported RogueMap version: ${version}. Only version 2 is supported.`,
      );

    // Capacity
    const capacity = data.readUInt32LE(cursor);
    cursor += 4;

    // Size
    const size = data.readUInt32LE(cursor);
    cursor += 4;

    // WriteOffset
    const writeOffset = data.readUInt32LE(cursor);
    cursor += 4;

    // BufferLength
    const bufferLength = data.readUInt32LE(cursor);
    cursor += 4;

    // Restore Buckets
    const bucketsSize = capacity * 4;
    const bucketsBuffer = data.subarray(cursor, cursor + bucketsSize);

    // We need to convert Int32Array (from buffer) to Float64Array
    // Since persisted format uses 4 bytes per bucket, it assumes offsets fit in 32-bit.
    // If we load a legacy format or a format that was saved when offsets were small, this is fine.
    // If we want to support >2GB persistence, we need to upgrade the format version.
    // For now, assume version 1 uses 32-bit buckets.

    // Copy to aligned buffer to satisfy Int32Array alignment requirements
    const alignedBucketsBuffer = Buffer.allocUnsafe(bucketsSize);
    bucketsBuffer.copy(alignedBucketsBuffer);

    // Create Float64Array for internal use
    const savedBuckets = new Float64Array(capacity);
    const tempInt32 = new Int32Array(
      alignedBucketsBuffer.buffer,
      alignedBucketsBuffer.byteOffset,
      bucketsSize / 4,
    );
    for (let i = 0; i < capacity; i++) {
      savedBuckets[i] = tempInt32[i];
    }

    cursor += bucketsSize;

    // Update instance state
    this.capacity = capacity;
    this.capacityMask = capacity - 1;
    this._hashes = new Int32Array(capacity);
    this._offsets = new Float64Array(capacity);
    this._size = size;
    this.writeOffset = writeOffset;
    this.buffer = PagedBuffer.allocUnsafe(bufferLength);
    this.buffer.writeBuffer(data.subarray(cursor, cursor + bufferLength), 0);
    this.rawBuffer = this.buffer.getSinglePage();

    this._deletedCount = 0;

    // REBUILD HASHES AND STATES
    // Rebuild Table
    const hashes = this._hashes;
    const offsets = this._offsets;
    // We have savedBuckets from load which are offsets
    for (let i = 0; i < this.capacity; i++) {
      const offset = savedBuckets[i];
      if (offset !== 0) {
        const flag = this.buffer.readUInt8(offset);
        if (flag === FLAG_ACTIVE) {
          const hash = this.buffer.readInt32LE(offset + 1);
          hashes[i] = hash;
          offsets[i] = offset; // Positive offset = Active
        } else if (flag === FLAG_DELETED) {
          const hash = this.buffer.readInt32LE(offset + 1);
          hashes[i] = hash;
          offsets[i] = -offset; // Negative offset = Deleted
        }
      }
    }
  }

  /**
   * Returns the number of elements in the map.
   */
  get size(): number {
    return this._size;
  }

  /**
   * Sets the value for the key in the map.
   *
   * @param key The key of the element to add to the RogueMap object.
   * @param value The value of the element to add to the RogueMap object.
   * @param options Optional settings like TTL.
   */
  set(key: K, value: V, options?: SetOptions): void {
    if (this.cache) {
      // Update cache on write
      if (this.cache.has(key)) {
        // Refresh
        this.cache.delete(key);
        this.cache.set(key, value);
      } else {
        // Add new? Maybe not. Cache is usually for "read hot", not "write hot".
        // But if we just wrote it, we likely read it soon.
        if (this.cache.size >= this.cacheSize) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey !== undefined) {
            const evictedVal = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            this.emit("evict", oldestKey, evictedVal);
          }
        }
        this.cache.set(key, value);
      }
    }

    if (this._size >= this.capacity * 0.75) {
      this.resize(this.capacity * 2, this.buffer.length * 2);
    }

    const hash = this.hasher(key) | 0;

    // Calculate ExpireAt
    let expireAt: number = 0; // 0 = no expiry
    const ttl = options?.ttl !== undefined ? options.ttl : this.defaultTTL;
    if (ttl > 0) {
      expireAt = Date.now() + ttl;
    }

    try {
      this.put(key, value, hash, expireAt);
      this.emit("set", key, value);
    } catch (e: any) {
      if (e.message === "RogueMap: Out of memory (Buffer full)") {
        // Calculate needed size roughly or just double repeatedly
        // A safer bet is to double until it fits, but we can't retry infinite times.
        // Let's try to resize to Math.max(current * 2, needed + overhead)
        // But we don't know 'needed' easily here without encoding.

        // Simple fix: Retry logic loop
        let retries = 0;
        while (retries < 3) {
          this.resize(this.capacity, this.buffer.length * 2);
          try {
            this.put(key, value, hash, expireAt);
            this.emit("set", key, value);
            break; // Success
          } catch (retryErr: any) {
            if (retryErr.message === "RogueMap: Out of memory (Buffer full)") {
              retries++;
              continue;
            }
            throw retryErr;
          }
        }
        if (retries === 3) throw e; // Give up
      } else if (e.message === "RogueMap: Hash table full") {
        // Should be caught by load factor check, but safe fallback
        this.resize(this.capacity * 2, this.buffer.length * 2);
        this.put(key, value, hash, expireAt);
        this.emit("set", key, value);
      } else {
        throw e;
      }
    }

    this.checkCompaction();
  }

  private put(key: K, value: V, hash: number, expireAt: number): void {
    const hashes = this._hashes;
    const offsets = this._offsets;
    const mask = this.capacityMask;

    // PRE-ENCODE KEY: Avoid re-encoding in the loop
    const keyLen = this.keyCodec.byteLength(key);
    // Ensure temp buffer is large enough
    if (this.tempKeyBuffer.length < keyLen) {
      this.tempKeyBuffer = Buffer.allocUnsafe(
        Math.max(keyLen, this.tempKeyBuffer.length * 2),
      );
    }
    this.keyCodec.encode(key, this.tempKeyBuffer, 0);

    let index = Math.abs(hash) & mask;
    const start_index = index;
    let tombstoneIndex = -1;

    // === OPTIMIZED PATH: Single Page Buffer (Direct Access) ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const tempKey = this.tempKeyBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;

      while (true) {
        const storedHash = hashes[index];
        const storedOffset = offsets[index];

        if (storedOffset === 0) {
          // Found empty slot
          // Reuse tombstone if found
          const finalIndex = tombstoneIndex !== -1 ? tombstoneIndex : index;

          // INLINE WRITE ENTRY
          const valLen = this.valueCodec.byteLength(value);
          let entrySize = 5 + 8; // Flag(1) + Hash(4) + ExpireAt(8)
          if (keyFixed === undefined) entrySize += 4;
          if (valFixed === undefined) entrySize += 4;
          entrySize += keyLen + valLen;

          if (this.writeOffset + entrySize > raw.length) {
            throw new Error("RogueMap: Out of memory (Buffer full)");
          }

          let cursor = this.writeOffset;
          raw[cursor++] = FLAG_ACTIVE;

          // Manual Write Hash (Int32LE)
          raw[cursor] = hash & 0xff;
          raw[cursor + 1] = (hash >>> 8) & 0xff;
          raw[cursor + 2] = (hash >>> 16) & 0xff;
          raw[cursor + 3] = (hash >>> 24) & 0xff;
          cursor += 4;

          // Write ExpireAt (Int64LE - split into two UInt32)
          // Since JS Numbers are Doubles (53-bit integer precision), we can write as Low/High 32-bit.
          // Date.now() fits in 53-bit.
          const low = expireAt % 0x100000000;
          const high = Math.floor(expireAt / 0x100000000);
          raw[cursor] = low & 0xff;
          raw[cursor + 1] = (low >>> 8) & 0xff;
          raw[cursor + 2] = (low >>> 16) & 0xff;
          raw[cursor + 3] = (low >>> 24) & 0xff;
          raw[cursor + 4] = high & 0xff;
          raw[cursor + 5] = (high >>> 8) & 0xff;
          raw[cursor + 6] = (high >>> 16) & 0xff;
          raw[cursor + 7] = (high >>> 24) & 0xff;
          cursor += 8;

          if (keyFixed === undefined) {
            // Manual Write KeyLen (Int32LE)
            raw[cursor] = keyLen & 0xff;
            raw[cursor + 1] = (keyLen >>> 8) & 0xff;
            raw[cursor + 2] = (keyLen >>> 16) & 0xff;
            raw[cursor + 3] = (keyLen >>> 24) & 0xff;
            cursor += 4;
          }
          if (valFixed === undefined) {
            // Manual Write ValLen (Int32LE)
            raw[cursor] = valLen & 0xff;
            raw[cursor + 1] = (valLen >>> 8) & 0xff;
            raw[cursor + 2] = (valLen >>> 16) & 0xff;
            raw[cursor + 3] = (valLen >>> 24) & 0xff;
            cursor += 4;
          }

          // Write Key
          if (keyLen > 0) {
            tempKey.copy(raw, cursor, 0, keyLen);
            cursor += keyLen;
          }

          // Write Val
          if (valLen > 0) {
            this.valueCodec.encode(value, raw, cursor);
            cursor += valLen;
          }

          hashes[finalIndex] = hash;
          offsets[finalIndex] = this.writeOffset; // Offset > 0 is Active
          this.writeOffset += entrySize;
          this._size++;
          return;
        }

        if (storedOffset < 0) {
          // Deleted
          if (tombstoneIndex === -1) tombstoneIndex = index;
        } else {
          // Active
          if (storedHash === hash) {
            // INLINE COMPARE
            let cursor = storedOffset + 5 + 8; // Flag(1) + Hash(4) + ExpireAt(8)
            let storedKeyLen = keyLen;
            if (keyFixed === undefined) {
              // Manual Read KeyLen (Int32LE)
              storedKeyLen =
                raw[cursor] |
                (raw[cursor + 1] << 8) |
                (raw[cursor + 2] << 16) |
                (raw[cursor + 3] << 24);
              cursor += 4;
            }
            if (valFixed === undefined) {
              cursor += 4; // Skip val len
            }

            if (storedKeyLen === keyLen) {
              // Adaptive Comparison
              let match = true;
              if (keyLen < 48) {
                // Short key path: JS Loop
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
              } else {
                // Long key path: Native Compare
                match =
                  raw.compare(tempKey, 0, keyLen, cursor, cursor + keyLen) ===
                  0;
              }

              if (match) {
                // MATCH FOUND - UPDATE
                // Mark old as deleted in buffer (optional but good for debugging/iteration)
                raw[storedOffset] = FLAG_DELETED;
                // Update table to deleted temporarily
                offsets[index] = -storedOffset;
                this._deletedCount++;

                // Append new
                const valLen = this.valueCodec.byteLength(value);
                let entrySize = 5 + 8; // Header V2
                if (keyFixed === undefined) entrySize += 4;
                if (valFixed === undefined) entrySize += 4;
                entrySize += keyLen + valLen;

                if (this.writeOffset + entrySize > raw.length) {
                  throw new Error("RogueMap: Out of memory (Buffer full)");
                }

                let wCursor = this.writeOffset;
                raw[wCursor++] = FLAG_ACTIVE;

                // Manual Write Hash
                raw[wCursor] = hash & 0xff;
                raw[wCursor + 1] = (hash >>> 8) & 0xff;
                raw[wCursor + 2] = (hash >>> 16) & 0xff;
                raw[wCursor + 3] = (hash >>> 24) & 0xff;
                wCursor += 4;

                // Write ExpireAt
                const low = expireAt % 0x100000000;
                const high = Math.floor(expireAt / 0x100000000);
                raw[wCursor] = low & 0xff;
                raw[wCursor + 1] = (low >>> 8) & 0xff;
                raw[wCursor + 2] = (low >>> 16) & 0xff;
                raw[wCursor + 3] = (low >>> 24) & 0xff;
                raw[wCursor + 4] = high & 0xff;
                raw[wCursor + 5] = (high >>> 8) & 0xff;
                raw[wCursor + 6] = (high >>> 16) & 0xff;
                raw[wCursor + 7] = (high >>> 24) & 0xff;
                wCursor += 8;

                if (keyFixed === undefined) {
                  raw[wCursor] = keyLen & 0xff;
                  raw[wCursor + 1] = (keyLen >>> 8) & 0xff;
                  raw[wCursor + 2] = (keyLen >>> 16) & 0xff;
                  raw[wCursor + 3] = (keyLen >>> 24) & 0xff;
                  wCursor += 4;
                }
                if (valFixed === undefined) {
                  raw[wCursor] = valLen & 0xff;
                  raw[wCursor + 1] = (valLen >>> 8) & 0xff;
                  raw[wCursor + 2] = (valLen >>> 16) & 0xff;
                  raw[wCursor + 3] = (valLen >>> 24) & 0xff;
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

                hashes[index] = hash;
                offsets[index] = this.writeOffset; // Update to new active
                this.writeOffset += entrySize;
                return;
              }
            }
          }
        }

        index = (index + 1) & mask;
        if (index === start_index) {
          throw new Error("RogueMap: Hash table full");
        }
      }
    }

    // === SLOW PATH: Multi-Page Buffer ===
    while (true) {
      const storedHash = hashes[index];
      const storedOffset = offsets[index];

      if (storedOffset === 0) {
        // Found empty slot
        const finalIndex = tombstoneIndex !== -1 ? tombstoneIndex : index;
        this.writeEntry(finalIndex, key, value, hash, expireAt);
        this._size++;
        return;
      }

      if (storedOffset < 0) {
        // Deleted
        if (tombstoneIndex === -1) tombstoneIndex = index;
      } else {
        // Active
        if (storedHash === hash) {
          if (this.keyMatchesPreEncoded(storedOffset, keyLen)) {
            // Mark old as deleted
            this.buffer.writeUInt8(FLAG_DELETED, storedOffset);
            offsets[index] = -storedOffset;
            this._deletedCount++;

            // Append new entry and update bucket
            this.writeEntry(index, key, value, hash, expireAt);
            return;
          }
        }
      }

      // Fast Modulo
      index = (index + 1) & mask;
      if (index === start_index) {
        throw new Error("RogueMap: Hash table full");
      }
    }
  }

  private checkCompaction() {
    if (!this.compaction.autoCompact) return;

    // Check if we have enough items to care
    if (this._size + this._deletedCount < (this.compaction.minSize || 1000))
      return;

    const ratio = this._deletedCount / (this._size + this._deletedCount);
    if (ratio > (this.compaction.threshold || 0.3)) {
      this.compact();
    }
  }

  private resize(newCapacity: number, newMemory: number) {
    const oldBuffer = this.buffer;
    const oldLimit = this.writeOffset;

    // Ensure power of 2
    if ((newCapacity & (newCapacity - 1)) !== 0) {
      newCapacity = Math.pow(2, Math.ceil(Math.log2(newCapacity)));
    }

    this.capacity = newCapacity;
    this.capacityMask = newCapacity - 1;
    this._hashes = new Int32Array(this.capacity);
    this._offsets = new Float64Array(this.capacity);
    // this.buckets = new Float64Array(this.capacity);
    // this.hashes = new Int32Array(this.capacity);
    // this.states = new Uint8Array(this.capacity);

    // ZERO-DECODE RESIZE: Direct Buffer Copy
    // We allocate the new buffer, but instead of decoding/encoding,
    // we copy the raw bytes of active entries directly.

    this.buffer = PagedBuffer.allocUnsafe(newMemory);
    this.rawBuffer = this.buffer.getSinglePage();

    const newRaw = this.rawBuffer;
    // If we can use single page for both, it's super fast
    const oldRaw = oldBuffer.getSinglePage();

    this.writeOffset = 1;
    this._size = 0;

    let cursor = 1;

    if (newRaw && oldRaw) {
      // === FASTEST PATH: Raw Buffer to Raw Buffer ===
      while (cursor < oldLimit) {
        const flag = oldRaw[cursor]; // Direct read

        // Layout: [Flag(1)] [Hash(4)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
        // Read Hash manually
        const hash =
          oldRaw[cursor + 1] |
          (oldRaw[cursor + 2] << 8) |
          (oldRaw[cursor + 3] << 16) |
          (oldRaw[cursor + 4] << 24);

        let entryLen = 5 + 8; // V2 Header
        let keySize: number, valSize: number;
        let kLenSize = 0,
          vLenSize = 0;

        if (this.keyCodec.fixedLength !== undefined) {
          keySize = this.keyCodec.fixedLength;
        } else {
          keySize =
            oldRaw[cursor + 5 + 8] |
            (oldRaw[cursor + 6 + 8] << 8) |
            (oldRaw[cursor + 7 + 8] << 16) |
            (oldRaw[cursor + 8 + 8] << 24);
          kLenSize = 4;
        }

        if (this.valueCodec.fixedLength !== undefined) {
          valSize = this.valueCodec.fixedLength;
        } else {
          const offset = cursor + 5 + 8 + kLenSize;
          valSize =
            oldRaw[offset] |
            (oldRaw[offset + 1] << 8) |
            (oldRaw[offset + 2] << 16) |
            (oldRaw[offset + 3] << 24);
          vLenSize = 4;
        }

        entryLen += kLenSize + vLenSize + keySize + valSize;

        if (flag === FLAG_ACTIVE) {
          // Copy Raw Entry
          if (this.writeOffset + entryLen > newRaw.length) {
            // Should not happen if newMemory is calculated correctly
            throw new Error("RogueMap: Resize failed (Buffer full)");
          }

          // Block Copy
          oldRaw.copy(newRaw, this.writeOffset, cursor, cursor + entryLen);

          // Insert into new Table
          // We need to re-probe because capacity changed
          let index = Math.abs(hash) & this.capacityMask;
          const start_index = index;
          const hashes = this._hashes;
          const offsets = this._offsets;

          while (true) {
            if (offsets[index] === 0) {
              // Empty
              hashes[index] = hash;
              offsets[index] = this.writeOffset;
              this._size++;
              break;
            }
            index = (index + 1) & this.capacityMask;
            if (index === start_index)
              throw new Error("RogueMap: Hash table full during resize");
          }

          this.writeOffset += entryLen;
        }

        cursor += entryLen;
      }
    } else {
      // Fallback to old resize logic for PagedBuffer (rare)
      // Or implement PagedBuffer copy
      // For now, let's keep the decode/encode loop for PagedBuffer case to be safe,
      // but 99% of use cases fit in 1GB (Single Page).
      // Actually, let's just use the old loop logic but adapted for new table structure
      while (cursor < oldLimit) {
        const flag = oldBuffer.readUInt8(cursor);
        const hash = oldBuffer.readInt32LE(cursor + 1);

        // Read ExpireAt (new V2 layout)
        // If resizing from old V1 layout... wait, we need to handle version migration?
        // For simplicity, assume buffer layout is consistent within instance lifetime.
        // We upgraded to V2 layout by default.
        const low = oldBuffer.readUInt32LE(cursor + 5);
        const high = oldBuffer.readUInt32LE(cursor + 9);
        const expireAt = high * 0x100000000 + low;

        let entryLen = 5 + 8;
        let keySize: number, valSize: number;
        let kLenSize = 0,
          vLenSize = 0;

        if (this.keyCodec.fixedLength !== undefined) {
          keySize = this.keyCodec.fixedLength;
        } else {
          keySize = oldBuffer.readInt32LE(cursor + 5 + 8);
          kLenSize = 4;
        }

        if (this.valueCodec.fixedLength !== undefined) {
          valSize = this.valueCodec.fixedLength;
        } else {
          valSize = oldBuffer.readInt32LE(cursor + 5 + 8 + kLenSize);
          vLenSize = 4;
        }

        entryLen += kLenSize + vLenSize + keySize + valSize;

        if (flag === FLAG_ACTIVE) {
          const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
          const keyBuf = oldBuffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);

          const valStart = keyStart + keySize;
          const valBuf = oldBuffer.readBuffer(valStart, valSize);
          const value = this.valueCodec.decode(valBuf, 0, valSize);

          this.put(key, value, hash, expireAt);
        }
        cursor += entryLen;
      }
    }
  }

  /**
   * Compacts the map by removing deleted entries and resizing the buffer to fit the active data.
   * This is useful to reclaim memory after many deletions.
   */
  compact(): void {
    // Resize to current capacity but optimize buffer size
    // Calculate required size for active entries
    let requiredSize = 1; // Initial offset
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);

      let entryLen = 5 + 8; // Flag + Hash + ExpireAt

      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5 + 8);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = this.buffer.readInt32LE(cursor + 5 + 8 + kLenSize);
        vLenSize = 4;
      }

      const totalLen = entryLen + kLenSize + vLenSize + keySize + valSize;

      if (flag === FLAG_ACTIVE) {
        // Check Expiration during compaction
        const low = this.buffer.readUInt32LE(cursor + 5);
        const high = this.buffer.readUInt32LE(cursor + 9);
        const expireAt = high * 0x100000000 + low;

        if (expireAt > 0 && Date.now() > expireAt) {
          // Expired! Treat as deleted (don't copy)
          // But compact logic copies ACTIVE. So we just skip adding to requiredSize.
          // Wait, if we skip adding, resize() will skip it too?
          // resize() iterates old buffer. We need to mark it DELETED before resize?
          // Or compact() calls resize() which does the copying.
          // The current compact() implementation calculates size then calls resize().
          // resize() iterates again.
          // Optimization: Mark as DELETED here so resize() skips it.

          // Decode key for event
          const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
          // Use readBuffer to be safe across pages (though compact implies we might be iterating)
          const keyBuf = this.buffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);
          this.emit("expire", key);

          this.buffer.writeUInt8(FLAG_DELETED, cursor);
          // We should also update index? But resize() rebuilds index from scratch.
          // So marking buffer as DELETED is enough for resize() to skip it.
          this._deletedCount++;
          this._size--; // Decrement size
        } else {
          requiredSize += totalLen;
        }
      }

      cursor += totalLen;
    }

    // Add 20% margin or minimum
    const newBufferSize = Math.max(requiredSize * 1.2, 1024);
    this.resize(this.capacity, newBufferSize);
    this._deletedCount = 0; // Reset deleted count

    // Trigger save if persistence enabled
    if (this.persistence && this.adapter) {
      this.save().catch(console.error);
    }
  }

  /**
   * Serializes the map state into a Buffer.
   * The returned buffer contains the full state of the map and can be saved to disk or transmitted.
   * Use RogueMap.deserialize() to restore the map from this buffer.
   */
  serialize(): Buffer {
    // Format:
    // [Magic: ROGUE(5)]
    // [Version: 2(1)] (Bump to 2 for TTL support)
    // [Capacity: 4]
    // [Size: 4]
    // [WriteOffset: 4]
    // [BufferLength: 4]
    // [Buckets: Capacity * 4]
    // [Buffer: BufferLength]

    // It is recommended to compact before serialize to save space, but we don't enforce it here.

    const headerSize = 5 + 1 + 4 + 4 + 4 + 4;
    const bucketsSize = this.capacity * 4;
    const bufferSize = this.writeOffset; // Only save used buffer

    const totalSize = headerSize + bucketsSize + bufferSize;

    // Check limit
    if (totalSize > 2 * 1024 * 1024 * 1024) {
      // Node.js Buffer size limit is usually 2GB or 4GB.
      // If we exceed 2GB, we risk failure depending on version.
      // We will try to alloc. If it fails, it throws.
    }

    const result = Buffer.allocUnsafe(totalSize);

    let cursor = 0;

    // Magic
    result.write("ROGUE", cursor);
    cursor += 5;

    // Version
    result.writeUInt8(2, cursor);
    cursor += 1;

    // Capacity
    result.writeUInt32LE(this.capacity, cursor);
    cursor += 4;

    // Size
    result.writeUInt32LE(this._size, cursor);
    cursor += 4;

    // WriteOffset
    result.writeUInt32LE(this.writeOffset, cursor);
    cursor += 4;

    // BufferLength (stored)
    result.writeUInt32LE(bufferSize, cursor);
    cursor += 4;

    // Buckets
    // Convert Float64Array table to Int32Array buffer for compatibility
    // We only need offsets for persistence compatibility (or upgrade format)
    // The current format expects [Offset, Offset, ...] (Int32)
    // Our table is [Hash, Offset, Hash, Offset]
    // So we need to extract every second element
    const tempInt32 = new Int32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      // Offset is at index 2*i + 1
      // If offset < 0 (deleted), we save 0? Or do we save tombstone?
      // Original logic didn't save tombstones in buckets array, they were just 0?
      // Wait, original logic: buckets[i] is offset. If state[i] is DELETED, bucket still points to it?
      // No, typically linear probing re-finds it.
      // Actually in serialize, we only save active offsets?
      // Let's check rebuild logic. Rebuild iterates buckets. If offset != 0, it reads flag.
      // If flag is DELETED, it restores state=DELETED.
      // So yes, we need to save the absolute offset even if deleted.
      const offset = this._offsets[i];
      tempInt32[i] = Math.abs(offset);
    }

    const bucketsBuffer = Buffer.from(
      tempInt32.buffer,
      tempInt32.byteOffset,
      tempInt32.byteLength,
    );
    bucketsBuffer.copy(result, cursor);
    cursor += bucketsSize;

    // Buffer
    // Need to copy from PagedBuffer to result Buffer
    this.buffer.copy(result, cursor, 0, bufferSize);

    return result;
  }

  /**
   * Creates a new RogueMap instance from a serialized buffer.
   *
   * @param data The buffer containing the serialized map data.
   * @param options Configuration options for the new instance.
   */
  static deserialize<K, V>(
    data: Buffer,
    options: RogueMapOptions<K, V> = {},
  ): RogueMap<K, V> {
    const map = new RogueMap<K, V>(options);
    map.loadFromBuffer(data);
    return map;
  }

  /**
   * Returns the value associated to the key, or undefined if there is none.
   *
   * @param key The key of the element to return.
   */
  get(key: K): V | undefined {
    // Check Cache
    if (this.cache) {
      const val = this.cache.get(key);
      if (val !== undefined) {
        // LRU: Refresh (delete and re-add)
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
      }
    }

    const hash = this.hasher(key) | 0;
    const hashes = this._hashes;
    const offsets = this._offsets;
    const mask = this.capacityMask;

    let index = Math.abs(hash) & mask;
    let start_index = index;

    // PRE-ENCODE KEY check only if needed (Lazy)
    let keyLen = 0;
    let encoded = false;

    // Helper to ensure encoded
    const ensureEncoded = () => {
      if (encoded) return;
      keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2),
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      encoded = true;
    };

    // === OPTIMIZED PATH ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;

      while (true) {
        const storedHash = hashes[index];
        const storedOffset = offsets[index];

        if (storedOffset === 0) return undefined;

        if (storedOffset > 0) {
          // Active
          if (storedHash === hash) {
            // Found hash match, now we must encode to compare
            ensureEncoded();
            const tempKey = this.tempKeyBuffer;

            // INLINE COMPARE
            let cursor = storedOffset + 5 + 8;
            let storedKeyLen = keyLen;
            if (keyFixed === undefined) {
              // Manual Read KeyLen
              storedKeyLen =
                raw[cursor] |
                (raw[cursor + 1] << 8) |
                (raw[cursor + 2] << 16) |
                (raw[cursor + 3] << 24);
              cursor += 4;
            }
            if (valFixed === undefined) {
              cursor += 4; // Skip val len
            }

            if (storedKeyLen === keyLen) {
              // Adaptive Comparison
              let match = true;
              if (keyLen < 48) {
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
              } else {
                match =
                  raw.compare(tempKey, 0, keyLen, cursor, cursor + keyLen) ===
                  0;
              }

              if (match) {
                // Check ExpireAt
                const eCursor = storedOffset + 5;
                const low =
                  raw[eCursor] |
                  (raw[eCursor + 1] << 8) |
                  (raw[eCursor + 2] << 16) |
                  (raw[eCursor + 3] << 24);
                const high =
                  raw[eCursor + 4] |
                  (raw[eCursor + 5] << 8) |
                  (raw[eCursor + 6] << 16) |
                  (raw[eCursor + 7] << 24);
                const expireAt = high * 0x100000000 + low;

                if (expireAt > 0 && Date.now() > expireAt) {
                  // Lazy Delete
                  raw[storedOffset] = FLAG_DELETED;
                  offsets[index] = -storedOffset;
                  this._deletedCount++;
                  this._size--;
                  this.checkCompaction();
                  this.emit("expire", key);
                  return undefined;
                }

                // MATCH! READ VALUE INLINE
                let vCursor = storedOffset + 5 + 8;
                if (keyFixed === undefined) vCursor += 4;

                let valLen: number;
                if (valFixed !== undefined) {
                  valLen = valFixed;
                } else {
                  // Manual Read ValLen
                  valLen =
                    raw[vCursor] |
                    (raw[vCursor + 1] << 8) |
                    (raw[vCursor + 2] << 16) |
                    (raw[vCursor + 3] << 24);
                  vCursor += 4;
                }

                vCursor += keyLen; // Skip Key

                // Read Val
                // Use Zero-Copy decoding if possible
                const val = this.valueCodec.decode(raw, vCursor, valLen);

                // Update Cache
                if (this.cache) {
                  if (this.cache.size >= this.cacheSize) {
                    const oldestKey = this.cache.keys().next().value;
                    if (oldestKey !== undefined) {
                      const evictedVal = this.cache.get(oldestKey);
                      this.cache.delete(oldestKey);
                      this.emit("evict", oldestKey, evictedVal);
                    }
                  }
                  this.cache.set(key, val);
                }
                return val;
              }
            }
          }
        }

        index = (index + 1) & mask;
        if (index === start_index) return undefined;
      }
    }

    while (true) {
      const storedHash = hashes[index];
      const storedOffset = offsets[index];

      if (storedOffset === 0) return undefined;

      // FAST PATH
      if (storedOffset > 0) {
        // Active
        if (storedHash === hash) {
          ensureEncoded();
          if (this.keyMatchesPreEncoded(storedOffset, keyLen)) {
            // Check Expiration
            const low = this.buffer.readUInt32LE(storedOffset + 5);
            const high = this.buffer.readUInt32LE(storedOffset + 9);
            const expireAt = high * 0x100000000 + low;

            if (expireAt > 0 && Date.now() > expireAt) {
              this.buffer.writeUInt8(FLAG_DELETED, storedOffset);
              offsets[index] = -storedOffset;
              this._deletedCount++;
              this._size--;
              this.checkCompaction();
              this.emit("expire", key);
              return undefined;
            }

            const val = this.readValue(storedOffset);
            // Update Cache
            if (this.cache) {
              if (this.cache.size >= this.cacheSize) {
                // Evict oldest (first key)
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey !== undefined) {
                  const evictedVal = this.cache.get(oldestKey);
                  this.cache.delete(oldestKey);
                  this.emit("evict", oldestKey, evictedVal);
                }
              }
              this.cache.set(key, val);
            }
            return val;
          }
        }
      }

      index = (index + 1) & mask;
      if (index === start_index) return undefined;
    }
  }

  /**
   * Returns a boolean asserting whether a value has been associated to the key in the RogueMap object or not.
   *
   * @param key The key of the element to test for presence.
   */
  has(key: K): boolean {
    const hash = this.hasher(key) | 0;
    const hashes = this._hashes;
    const offsets = this._offsets;
    const mask = this.capacityMask;

    let index = Math.abs(hash) & mask;
    let start_index = index;

    // PRE-ENCODE KEY check only if needed (Lazy)
    let keyLen = 0;
    let encoded = false;

    // Helper to ensure encoded
    const ensureEncoded = () => {
      if (encoded) return;
      keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2),
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      encoded = true;
    };

    // === OPTIMIZED PATH ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;

      while (true) {
        const storedHash = hashes[index];
        const storedOffset = offsets[index];

        if (storedOffset === 0) return false;

        if (storedOffset > 0) {
          // Active
          if (storedHash === hash) {
            // INLINE COMPARE
            ensureEncoded();
            const tempKey = this.tempKeyBuffer;
            let cursor = storedOffset + 5 + 8;
            let storedKeyLen = keyLen;
            if (keyFixed === undefined) {
              // Manual Read KeyLen
              storedKeyLen =
                raw[cursor] |
                (raw[cursor + 1] << 8) |
                (raw[cursor + 2] << 16) |
                (raw[cursor + 3] << 24);
              cursor += 4;
            }
            if (valFixed === undefined) cursor += 4;

            if (storedKeyLen === keyLen) {
              // Adaptive Comparison
              let match = true;
              if (keyLen < 48) {
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
              } else {
                match =
                  raw.compare(tempKey, 0, keyLen, cursor, cursor + keyLen) ===
                  0;
              }

              if (match) {
                // Check Expiration
                const eCursor = storedOffset + 5;
                const low =
                  raw[eCursor] |
                  (raw[eCursor + 1] << 8) |
                  (raw[eCursor + 2] << 16) |
                  (raw[eCursor + 3] << 24);
                const high =
                  raw[eCursor + 4] |
                  (raw[eCursor + 5] << 8) |
                  (raw[eCursor + 6] << 16) |
                  (raw[eCursor + 7] << 24);
                const expireAt = high * 0x100000000 + low;

                if (expireAt > 0 && Date.now() > expireAt) {
                  // Lazy Delete
                  raw[storedOffset] = FLAG_DELETED;
                  offsets[index] = -storedOffset;
                  this._deletedCount++;
                  this._size--;
                  this.checkCompaction();
                  this.emit("expire", key);
                  return false;
                }
                return true;
              }
            }
          }
        }

        index = (index + 1) & mask;
        if (index === start_index) return false;
      }
    }

    while (true) {
      const storedHash = hashes[index];
      const storedOffset = offsets[index];

      if (storedOffset === 0) return false;

      // FAST PATH
      if (storedOffset > 0) {
        // Active
        if (storedHash === hash) {
          ensureEncoded();
          if (this.keyMatchesPreEncoded(storedOffset, keyLen)) {
            // Check Expiration
            const low = this.buffer.readUInt32LE(storedOffset + 5);
            const high = this.buffer.readUInt32LE(storedOffset + 9);
            const expireAt = high * 0x100000000 + low;

            if (expireAt > 0 && Date.now() > expireAt) {
              this.buffer.writeUInt8(FLAG_DELETED, storedOffset);
              offsets[index] = -storedOffset;
              this._deletedCount++;
              this._size--;
              this.checkCompaction();
              this.emit("expire", key);
              return false;
            }
            return true;
          }
        }
      }

      index = (index + 1) & mask;
      if (index === start_index) return false;
    }
  }

  /**
   * Removes the specified element from the RogueMap object.
   * Returns true if an element in the RogueMap object existed and has been removed, or false if the element does not exist.
   *
   * @param key The key of the element to remove.
   */
  delete(key: K): boolean {
    if (this.cache) {
      this.cache.delete(key);
    }

    const hash = this.hasher(key) | 0;
    const hashes = this._hashes;
    const offsets = this._offsets;
    const mask = this.capacityMask;

    let index = Math.abs(hash) & mask;
    let start_index = index;

    // PRE-ENCODE KEY check only if needed (Lazy)
    let keyLen = 0;
    let encoded = false;

    const ensureEncoded = () => {
      if (encoded) return;
      keyLen = this.keyCodec.byteLength(key);
      if (this.tempKeyBuffer.length < keyLen) {
        this.tempKeyBuffer = Buffer.allocUnsafe(
          Math.max(keyLen, this.tempKeyBuffer.length * 2),
        );
      }
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      encoded = true;
    };

    // === OPTIMIZED PATH ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;

      while (true) {
        const storedHash = hashes[index];
        const storedOffset = offsets[index];

        if (storedOffset === 0) return false;

        if (storedOffset > 0) {
          // Active
          if (storedHash === hash) {
            // INLINE COMPARE
            ensureEncoded();
            const tempKey = this.tempKeyBuffer;
            let cursor = storedOffset + 5 + 8;
            let storedKeyLen = keyLen;
            if (keyFixed === undefined) {
              // Manual Read KeyLen
              storedKeyLen =
                raw[cursor] |
                (raw[cursor + 1] << 8) |
                (raw[cursor + 2] << 16) |
                (raw[cursor + 3] << 24);
              cursor += 4;
            }
            if (valFixed === undefined) cursor += 4;

            if (storedKeyLen === keyLen) {
              // Adaptive Comparison
              let match = true;
              if (keyLen < 48) {
                for (let k = 0; k < keyLen; k++) {
                  if (raw[cursor + k] !== tempKey[k]) {
                    match = false;
                    break;
                  }
                }
              } else {
                match =
                  raw.compare(tempKey, 0, keyLen, cursor, cursor + keyLen) ===
                  0;
              }

              if (match) {
                // Check Expiration
                const eCursor = storedOffset + 5;
                const low =
                  raw[eCursor] |
                  (raw[eCursor + 1] << 8) |
                  (raw[eCursor + 2] << 16) |
                  (raw[eCursor + 3] << 24);
                const high =
                  raw[eCursor + 4] |
                  (raw[eCursor + 5] << 8) |
                  (raw[eCursor + 6] << 16) |
                  (raw[eCursor + 7] << 24);
                const expireAt = high * 0x100000000 + low;

                if (expireAt > 0 && Date.now() > expireAt) {
                  // Lazy Delete (return false as if not found)
                  raw[storedOffset] = FLAG_DELETED;
                  offsets[index] = -storedOffset;
                  this._deletedCount++;
                  this._size--;
                  this.checkCompaction();
                  this.emit("expire", key);
                  return false;
                }

                // MATCH! DELETE INLINE
                raw[storedOffset] = FLAG_DELETED;
                offsets[index] = -storedOffset; // Mark deleted
                this._size--;
                this._deletedCount++;
                this.checkCompaction();
                this.emit("delete", key);
                return true;
              }
            }
          }
        }

        index = (index + 1) & mask;
        if (index === start_index) return false;
      }
    }

    while (true) {
      const storedHash = hashes[index];
      const storedOffset = offsets[index];

      if (storedOffset === 0) return false;

      // FAST PATH
      if (storedOffset > 0) {
        // Active
        if (storedHash === hash) {
          ensureEncoded();
          if (this.keyMatchesPreEncoded(storedOffset, keyLen)) {
            // Check Expiration
            const low = this.buffer.readUInt32LE(storedOffset + 5);
            const high = this.buffer.readUInt32LE(storedOffset + 9);
            const expireAt = high * 0x100000000 + low;

            if (expireAt > 0 && Date.now() > expireAt) {
              this.buffer.writeUInt8(FLAG_DELETED, storedOffset);
              offsets[index] = -storedOffset;
              this._deletedCount++;
              this._size--;
              this.checkCompaction();
              this.emit("expire", key);
              return false;
            }

            this.buffer.writeUInt8(FLAG_DELETED, storedOffset);
            offsets[index] = -storedOffset; // Update state
            this._size--;
            this._deletedCount++;
            this.checkCompaction();
            this.emit("delete", key);
            return true;
          }
        }
      }

      index = (index + 1) & mask;
      if (index === start_index) return false;
    }
  }

  /**
   * Removes all elements from the RogueMap object.
   */
  clear(): void {
    if (this.cache) {
      this.cache.clear();
    }
    this._hashes.fill(0);
    this._offsets.fill(0);
    this.writeOffset = 1;
    this._size = 0;
    this._deletedCount = 0;
    this.emit("clear");
  }

  private writeEntry(
    index: number,
    key: K,
    value: V,
    hash: number,
    expireAt: number,
  ) {
    // Calculate size
    const keySize = this.keyCodec.byteLength(key);
    const valSize = this.valueCodec.byteLength(value);

    const keyFixed = this.keyCodec.fixedLength !== undefined;
    const valFixed = this.valueCodec.fixedLength !== undefined;

    // Layout: [Flag(1)] [Hash(4)] [ExpireAt(8)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
    let entrySize = 5 + 8; // Flag + Hash + ExpireAt
    if (!keyFixed) entrySize += 4;
    if (!valFixed) entrySize += 4;
    entrySize += keySize + valSize;

    // Check buffer space
    if (this.writeOffset + entrySize > this.buffer.length) {
      throw new Error("RogueMap: Out of memory (Buffer full)");
    }

    const offset = this.writeOffset;
    let cursor = offset;

    // Write Flag
    this.buffer.writeUInt8(FLAG_ACTIVE, cursor);
    cursor += 1;

    // Write Hash
    this.buffer.writeInt32LE(hash, cursor);
    cursor += 4;

    // Write ExpireAt (Int64LE)
    const low = expireAt % 0x100000000;
    const high = Math.floor(expireAt / 0x100000000);
    this.buffer.writeUInt32LE(low, cursor);
    this.buffer.writeUInt32LE(high, cursor + 4);
    cursor += 8;

    // Write Key Len
    if (!keyFixed) {
      this.buffer.writeInt32LE(keySize, cursor);
      cursor += 4;
    }

    // Write Val Len
    if (!valFixed) {
      this.buffer.writeInt32LE(valSize, cursor);
      cursor += 4;
    }

    // Write Key
    // Use temp buffer to ensure compatibility with Codec interfaces that expect Buffer
    if (keySize > 0) {
      const keyBuf = Buffer.allocUnsafe(keySize);
      this.keyCodec.encode(key, keyBuf, 0);
      this.buffer.writeBuffer(keyBuf, cursor);
      cursor += keySize;
    }

    // Write Val
    if (valSize > 0) {
      const valBuf = Buffer.allocUnsafe(valSize);
      this.valueCodec.encode(value, valBuf, 0);
      this.buffer.writeBuffer(valBuf, cursor);
      cursor += valSize;
    }

    // Update state
    this.writeOffset += entrySize;

    this._hashes[index] = hash;
    this._offsets[index] = offset; // Active
  }

  private keyMatchesPreEncoded(offset: number, keyLen: number): boolean {
    let cursor = offset + 5 + 8; // Skip Flag(1) + Hash(4) + ExpireAt(8)

    let keySize: number;
    if (this.keyCodec.fixedLength !== undefined) {
      keySize = this.keyCodec.fixedLength;
    } else {
      keySize = this.buffer.readInt32LE(cursor);
      cursor += 4;
    }

    // Skip ValLen if present
    if (this.valueCodec.fixedLength === undefined) {
      cursor += 4;
    }

    // Optimization: Compare byte length first
    if (keyLen !== keySize) return false;

    // Zero-Allocation Compare: Use pre-encoded key
    // For UCS-2, byte comparison is valid (same bytes)
    return (
      this.buffer.compare(
        this.tempKeyBuffer,
        0,
        keyLen,
        cursor,
        cursor + keySize,
      ) === 0
    );
  }

  private keyMatches(offset: number, key: K): boolean {
    // Deprecated in favor of keyMatchesPreEncoded, keeping just in case or for testing
    // Logic is same as before
    let cursor = offset + 5 + 8; // Skip Flag(1) + Hash(4) + ExpireAt(8)

    let keySize: number;
    if (this.keyCodec.fixedLength !== undefined) {
      keySize = this.keyCodec.fixedLength;
    } else {
      keySize = this.buffer.readInt32LE(cursor);
      cursor += 4;
    }

    if (this.valueCodec.fixedLength === undefined) {
      cursor += 4;
    }

    const len = this.keyCodec.byteLength(key);
    if (len !== keySize) return false;

    if (len <= this.tempKeyBuffer.length) {
      this.keyCodec.encode(key, this.tempKeyBuffer, 0);
      return (
        this.buffer.compare(
          this.tempKeyBuffer,
          0,
          len,
          cursor,
          cursor + keySize,
        ) === 0
      );
    }

    const temp = Buffer.allocUnsafe(len);
    this.keyCodec.encode(key, temp, 0);
    return this.buffer.compare(temp, 0, len, cursor, cursor + keySize) === 0;
  }

  private readValue(offset: number): V {
    let cursor = offset + 5 + 8; // Skip Flag(1) + Hash(4) + ExpireAt(8)

    // Read/Skip KeyLen
    let keySize: number;
    if (this.keyCodec.fixedLength !== undefined) {
      keySize = this.keyCodec.fixedLength;
    } else {
      keySize = this.buffer.readInt32LE(cursor);
      cursor += 4;
    }

    // Read ValLen
    let valSize: number;
    if (this.valueCodec.fixedLength !== undefined) {
      valSize = this.valueCodec.fixedLength;
    } else {
      valSize = this.buffer.readInt32LE(cursor);
      cursor += 4;
    }

    // Skip Key Data
    cursor += keySize;

    // Zero-Copy Read
    const view = this.buffer.tryGetView(cursor, valSize);
    if (view) {
      return this.valueCodec.decode(view.buffer, view.offset, valSize);
    }

    // Fallback for cross-page reads
    const valBuf = this.buffer.readBuffer(cursor, valSize);
    return this.valueCodec.decode(valBuf, 0, valSize);
  }

  /**
   * Returns a new Async Iterator object that contains the [key, value] pairs for each element in the RogueMap object.
   * This iterator yields execution to the event loop every `batchSize` items to avoid blocking the main thread.
   *
   * @param batchSize Number of items to yield before pausing (default: 100).
   */
  async *asyncEntries(batchSize: number = 100): AsyncIterableIterator<[K, V]> {
    let count = 0;
    for (const entry of this.entries()) {
      yield entry;
      count++;
      if (count % batchSize === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  /**
   * Returns a new Iterator object that contains the [key, value] pairs for each element in the RogueMap object in insertion order.
   * Note: The order is based on internal buffer layout, which is roughly insertion order but affected by deletions and updates.
   */
  *entries(): IterableIterator<[K, V]> {
    // === OPTIMIZED PATH: Single Page Buffer ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;
      let cursor = 1;
      const limit = this.writeOffset;

      while (cursor < limit) {
        const flag = raw[cursor]; // raw.readUInt8(cursor)

        let entryLen = 5 + 8; // V2 Header
        let keySize: number, valSize: number;
        let kLenSize = 0,
          vLenSize = 0;

        if (keyFixed !== undefined) {
          keySize = keyFixed;
        } else {
          // Manual Read KeyLen
          keySize =
            raw[cursor + 5 + 8] |
            (raw[cursor + 6 + 8] << 8) |
            (raw[cursor + 7 + 8] << 16) |
            (raw[cursor + 8 + 8] << 24);
          kLenSize = 4;
        }

        if (valFixed !== undefined) {
          valSize = valFixed;
        } else {
          // Manual Read ValLen
          const offset = cursor + 5 + 8 + kLenSize;
          valSize =
            raw[offset] |
            (raw[offset + 1] << 8) |
            (raw[offset + 2] << 16) |
            (raw[offset + 3] << 24);
          vLenSize = 4;
        }

        entryLen += kLenSize + vLenSize + keySize + valSize;

        if (flag === FLAG_ACTIVE) {
          // Check ExpireAt
          const low =
            raw[cursor + 5] |
            (raw[cursor + 6] << 8) |
            (raw[cursor + 7] << 16) |
            (raw[cursor + 8] << 24);
          const high =
            raw[cursor + 9] |
            (raw[cursor + 10] << 8) |
            (raw[cursor + 11] << 16) |
            (raw[cursor + 12] << 24);
          const expireAt = high * 0x100000000 + low; // 0x100000000 is 2^32

          if (expireAt === 0 || Date.now() <= expireAt) {
            const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
            // Use zero-copy view if codec supports it
            const key = this.keyCodec.decode(raw, keyStart, keySize);

            const valStart = keyStart + keySize;
            const value = this.valueCodec.decode(raw, valStart, valSize);

            yield [key, value];
          }
        }

        cursor += entryLen;
      }
      return;
    }

    // === SLOW PATH ===
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);

      // Layout: [Flag(1)] [Hash(4)] [ExpireAt(8)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
      let entryLen = 5 + 8;

      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5 + 8);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = this.buffer.readInt32LE(cursor + 5 + 8 + kLenSize);
        vLenSize = 4;
      }

      entryLen += kLenSize + vLenSize + keySize + valSize;

      if (flag === FLAG_ACTIVE) {
        const low = this.buffer.readUInt32LE(cursor + 5);
        const high = this.buffer.readUInt32LE(cursor + 9);
        const expireAt = high * 0x100000000 + low;

        if (expireAt === 0 || Date.now() <= expireAt) {
          const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
          const keyBuf = this.buffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);

          const valStart = keyStart + keySize;
          const valBuf = this.buffer.readBuffer(valStart, valSize);
          const value = this.valueCodec.decode(valBuf, 0, valSize);

          yield [key, value];
        }
      }

      cursor += entryLen;
    }
  }

  /**
   * Returns a new Iterator object that contains the keys for each element in the RogueMap object.
   */
  *keys(): IterableIterator<K> {
    // === OPTIMIZED PATH: Single Page Buffer ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;
      let cursor = 1;
      const limit = this.writeOffset;

      while (cursor < limit) {
        const flag = raw[cursor];

        let entryLen = 5 + 8; // V2 Header
        let keySize: number, valSize: number;
        let kLenSize = 0,
          vLenSize = 0;

        if (keyFixed !== undefined) {
          keySize = keyFixed;
        } else {
          keySize =
            raw[cursor + 5 + 8] |
            (raw[cursor + 6 + 8] << 8) |
            (raw[cursor + 7 + 8] << 16) |
            (raw[cursor + 8 + 8] << 24);
          kLenSize = 4;
        }

        if (valFixed !== undefined) {
          valSize = valFixed;
        } else {
          const offset = cursor + 5 + 8 + kLenSize;
          valSize =
            raw[offset] |
            (raw[offset + 1] << 8) |
            (raw[offset + 2] << 16) |
            (raw[offset + 3] << 24);
          vLenSize = 4;
        }

        entryLen += kLenSize + vLenSize + keySize + valSize;

        if (flag === FLAG_ACTIVE) {
          // Check ExpireAt
          const low =
            raw[cursor + 5] |
            (raw[cursor + 6] << 8) |
            (raw[cursor + 7] << 16) |
            (raw[cursor + 8] << 24);
          const high =
            raw[cursor + 9] |
            (raw[cursor + 10] << 8) |
            (raw[cursor + 11] << 16) |
            (raw[cursor + 12] << 24);
          const expireAt = high * 0x100000000 + low;

          if (expireAt === 0 || Date.now() <= expireAt) {
            const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
            // LAZY DECODING: Only decode key
            const key = this.keyCodec.decode(raw, keyStart, keySize);
            yield key;
          }
        }

        cursor += entryLen;
      }
      return;
    }

    // === SLOW PATH ===
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);
      let entryLen = 5 + 8; // V2 Header
      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5 + 8);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = this.buffer.readInt32LE(cursor + 5 + 8 + kLenSize);
        vLenSize = 4;
      }

      entryLen += kLenSize + vLenSize + keySize + valSize;

      if (flag === FLAG_ACTIVE) {
        // Check ExpireAt
        const low = this.buffer.readUInt32LE(cursor + 5);
        const high = this.buffer.readUInt32LE(cursor + 9);
        const expireAt = high * 0x100000000 + low;

        if (expireAt === 0 || Date.now() <= expireAt) {
          const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
          const keyBuf = this.buffer.readBuffer(keyStart, keySize);
          const key = this.keyCodec.decode(keyBuf, 0, keySize);
          yield key;
        }
      }

      cursor += entryLen;
    }
  }

  /**
   * Returns a new Iterator object that contains the values for each element in the RogueMap object.
   */
  *values(): IterableIterator<V> {
    // === OPTIMIZED PATH: Single Page Buffer ===
    if (this.rawBuffer) {
      const raw = this.rawBuffer;
      const keyFixed = this.keyCodec.fixedLength;
      const valFixed = this.valueCodec.fixedLength;
      let cursor = 1;
      const limit = this.writeOffset;

      while (cursor < limit) {
        const flag = raw[cursor];

        let entryLen = 5 + 8; // V2 Header
        let keySize: number, valSize: number;
        let kLenSize = 0,
          vLenSize = 0;

        if (keyFixed !== undefined) {
          keySize = keyFixed;
        } else {
          keySize =
            raw[cursor + 5 + 8] |
            (raw[cursor + 6 + 8] << 8) |
            (raw[cursor + 7 + 8] << 16) |
            (raw[cursor + 8 + 8] << 24);
          kLenSize = 4;
        }

        if (valFixed !== undefined) {
          valSize = valFixed;
        } else {
          const offset = cursor + 5 + 8 + kLenSize;
          valSize =
            raw[offset] |
            (raw[offset + 1] << 8) |
            (raw[offset + 2] << 16) |
            (raw[offset + 3] << 24);
          vLenSize = 4;
        }

        entryLen += kLenSize + vLenSize + keySize + valSize;

        if (flag === FLAG_ACTIVE) {
          // Check ExpireAt
          const low =
            raw[cursor + 5] |
            (raw[cursor + 6] << 8) |
            (raw[cursor + 7] << 16) |
            (raw[cursor + 8] << 24);
          const high =
            raw[cursor + 9] |
            (raw[cursor + 10] << 8) |
            (raw[cursor + 11] << 16) |
            (raw[cursor + 12] << 24);
          const expireAt = high * 0x100000000 + low;

          if (expireAt === 0 || Date.now() <= expireAt) {
            // LAZY DECODING: Only decode value
            const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
            const valStart = keyStart + keySize;
            const value = this.valueCodec.decode(raw, valStart, valSize);
            yield value;
          }
        }

        cursor += entryLen;
      }
      return;
    }

    // === SLOW PATH ===
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);
      let entryLen = 5 + 8; // V2 Header
      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5 + 8);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = this.buffer.readInt32LE(cursor + 5 + 8 + kLenSize);
        vLenSize = 4;
      }

      entryLen += kLenSize + vLenSize + keySize + valSize;

      if (flag === FLAG_ACTIVE) {
        // Check ExpireAt
        const low = this.buffer.readUInt32LE(cursor + 5);
        const high = this.buffer.readUInt32LE(cursor + 9);
        const expireAt = high * 0x100000000 + low;

        if (expireAt === 0 || Date.now() <= expireAt) {
          const keyStart = cursor + 5 + 8 + kLenSize + vLenSize;
          const valStart = keyStart + keySize;
          const valBuf = this.buffer.readBuffer(valStart, valSize);
          const value = this.valueCodec.decode(valBuf, 0, valSize);
          yield value;
        }
      }

      cursor += entryLen;
    }
  }

  /**
   * Returns a new Iterator object that contains the [key, value] pairs for each element in the RogueMap object.
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /**
   * Executes a provided function once per each key/value pair in the RogueMap object.
   *
   * @param callback Function to execute for each element.
   * @param thisArg Value to use as this when executing callback.
   */
  forEach(
    callback: (value: V, key: K, map: RogueMap<K, V>) => void,
    thisArg?: any,
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }
}
