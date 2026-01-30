import { Codec } from "./interfaces";
import { AnyCodec } from "./codecs";
import { fnv1a, numberHash } from "./utils";
import {
  PersistenceOptions,
  CompactionOptions,
  PersistenceAdapter,
} from "./persistence/interfaces";
import { PersistenceManager } from "./persistence/manager";
import { PagedBuffer } from "./PagedBuffer";

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
}

const DEFAULT_CAPACITY = 16384;
const DEFAULT_MEMORY = 10 * 1024 * 1024; // 10MB
const FLAG_ACTIVE = 1;
const FLAG_DELETED = 2;

/**
 * RogueMap: A high-performance, off-heap hash map for Node.js.
 *
 * Stores data in a Node.js Buffer to reduce GC overhead and heap usage.
 * Supports custom codecs, persistence, and an optional LRU cache for hot reads.
 *
 * @template K Type of keys (must be supported by keyCodec)
 * @template V Type of values (must be supported by valueCodec)
 */
export class RogueMap<K = any, V = any> {
  private capacity: number;
  private buffer: PagedBuffer;
  private buckets: Float64Array; // Changed to Float64Array to support >2GB offsets
  private hashes: Int32Array;
  private states: Uint8Array;
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

  private tempKeyBuffer: Buffer = Buffer.allocUnsafe(1024); // Reusable buffer for key comparison

  /**
   * Creates a new RogueMap instance.
   *
   * @param options Configuration options
   */
  constructor(options: RogueMapOptions<K, V> = {}) {
    this.capacity = options.capacity || DEFAULT_CAPACITY;
    this.buckets = new Float64Array(this.capacity);
    this.hashes = new Int32Array(this.capacity);
    this.states = new Uint8Array(this.capacity); // 0=Empty, 1=Active, 2=Deleted
    this.buffer = PagedBuffer.allocUnsafe(
      options.initialMemory || DEFAULT_MEMORY,
    );
    this.writeOffset = 1; // Start at 1 because 0 in buckets means empty

    // Default to AnyCodec for maximum flexibility if no codec is provided
    this.keyCodec = options.keyCodec || (AnyCodec as unknown as Codec<K>);
    this.valueCodec = options.valueCodec || (AnyCodec as unknown as Codec<V>);

    this.cacheSize = options.cacheSize || 0;
    if (this.cacheSize > 0) {
      this.cache = new Map();
    }

    if (options.hasher) {
      this.hasher = options.hasher;
    } else {
      // Default hasher inference
      this.hasher = (key: K) => {
        if (typeof key === "string") return fnv1a(key);
        if (typeof key === "number") return numberHash(key);
        if (Buffer.isBuffer(key)) return fnv1a(key.toString("binary"));
        return fnv1a(String(key));
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
    if (version !== 1)
      throw new Error(`Unsupported RogueMap version: ${version}`);

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
    this.buckets = savedBuckets;
    this.hashes = new Int32Array(capacity);
    this.states = new Uint8Array(capacity);
    this._size = size;
    this.writeOffset = writeOffset;
    this.buffer = PagedBuffer.allocUnsafe(bufferLength);
    this.buffer.writeBuffer(data.subarray(cursor, cursor + bufferLength), 0);

    this._deletedCount = 0;

    // REBUILD HASHES AND STATES
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
  get size(): number {
    return this._size;
  }

  /**
   * Sets the value for the key in the map.
   *
   * @param key The key of the element to add to the RogueMap object.
   * @param value The value of the element to add to the RogueMap object.
   */
  set(key: K, value: V): void {
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
          if (oldestKey !== undefined) this.cache.delete(oldestKey);
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
            this.put(key, value, hash);
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
        this.put(key, value, hash);
      } else {
        throw e;
      }
    }

    this.checkCompaction();
  }

  private put(key: K, value: V, hash: number): void {
    const buckets = this.buckets;
    const states = this.states;
    const hashes = this.hashes;
    const capacity = this.capacity;

    let index = Math.abs(hash % capacity);
    let start_index = index;
    let tombstoneIndex = -1;

    // PRE-ENCODE KEY: Avoid re-encoding in the loop
    const keyLen = this.keyCodec.byteLength(key);
    // Ensure temp buffer is large enough
    if (this.tempKeyBuffer.length < keyLen) {
      this.tempKeyBuffer = Buffer.allocUnsafe(
        Math.max(keyLen, this.tempKeyBuffer.length * 2),
      );
    }
    this.keyCodec.encode(key, this.tempKeyBuffer, 0);

    // Linear probing to find existing key or empty slot
    while (true) {
      const offset = buckets[index];

      if (offset === 0) {
        // Found empty slot
        if (tombstoneIndex !== -1) {
          index = tombstoneIndex; // Reuse tombstone if found
        }
        this.writeEntry(index, key, value, hash);
        this._size++;
        return;
      }

      // Check if deleted or match
      // FAST PATH: Use states array
      const state = states[index];

      if (state === FLAG_DELETED) {
        if (tombstoneIndex === -1) tombstoneIndex = index;
      } else if (state === FLAG_ACTIVE) {
        // Active entry, check key
        // FAST PATH: Check hash from Int32Array
        if (hashes[index] === hash) {
          // Only now we read buffer
          if (this.keyMatchesPreEncoded(offset, keyLen)) {
            // Mark old as deleted
            this.buffer.writeUInt8(FLAG_DELETED, offset);
            states[index] = FLAG_DELETED; // Update state
            this._deletedCount++;

            // Append new entry and update bucket
            this.writeEntry(index, key, value, hash);
            return;
          }
        }
      }

      index = (index + 1) % capacity;
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

    this.capacity = newCapacity;
    this.buckets = new Float64Array(this.capacity);
    this.hashes = new Int32Array(this.capacity);
    this.states = new Uint8Array(this.capacity);
    this.buffer = PagedBuffer.allocUnsafe(newMemory);
    this.writeOffset = 1;
    this._size = 0;

    let cursor = 1;
    while (cursor < oldLimit) {
      const flag = oldBuffer.readUInt8(cursor);

      // Layout: [Flag(1)] [Hash(4)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
      const hash = oldBuffer.readInt32LE(cursor + 1);

      let entryLen = 5; // Flag + Hash

      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = oldBuffer.readInt32LE(cursor + 5);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
        valSize = this.valueCodec.fixedLength;
      } else {
        valSize = oldBuffer.readInt32LE(cursor + 5 + kLenSize);
        vLenSize = 4;
      }

      entryLen += kLenSize + vLenSize + keySize + valSize;

      if (flag === FLAG_ACTIVE) {
        // Copy to new buffer via put()
        // We decode to get the key for hashing
        const keyStart = cursor + 5 + kLenSize + vLenSize;

        // Read key buffer from old PagedBuffer
        const keyBuf = oldBuffer.readBuffer(keyStart, keySize);
        const key = this.keyCodec.decode(keyBuf, 0, keySize);

        // Read val buffer from old PagedBuffer
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
  compact(): void {
    // Resize to current capacity but optimize buffer size
    // Calculate required size for active entries
    let requiredSize = 1; // Initial offset
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);

      let entryLen = 5; // Flag + Hash

      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
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
    // [Version: 1(1)]
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
    result.writeUInt8(1, cursor);
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
    // Convert Float64Array to Int32Array buffer for compatibility
    // WARNING: If offsets > 2GB, this will truncate/wrap and corrupt data!
    // For now, we assume serialize is only used for < 2GB maps.
    // TODO: Upgrade format version to support 64-bit offsets.
    const tempInt32 = new Int32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) tempInt32[i] = this.buckets[i];

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
    const capacity = this.capacity;
    const buckets = this.buckets;
    const states = this.states;
    const hashes = this.hashes;

    let index = Math.abs(hash % capacity);
    let start_index = index;

    // PRE-ENCODE KEY for keyMatchesPreEncoded
    const keyLen = this.keyCodec.byteLength(key);
    if (this.tempKeyBuffer.length < keyLen) {
      this.tempKeyBuffer = Buffer.allocUnsafe(
        Math.max(keyLen, this.tempKeyBuffer.length * 2),
      );
    }
    this.keyCodec.encode(key, this.tempKeyBuffer, 0);

    while (true) {
      const offset = buckets[index];
      if (offset === 0) return undefined;

      // FAST PATH
      if (states[index] === FLAG_ACTIVE) {
        if (hashes[index] === hash) {
          // Only now we read buffer
          if (this.keyMatchesPreEncoded(offset, keyLen)) {
            const val = this.readValue(offset);
            // Update Cache
            if (this.cache) {
              if (this.cache.size >= this.cacheSize) {
                // Evict oldest (first key)
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey !== undefined) this.cache.delete(oldestKey);
              }
              this.cache.set(key, val);
            }
            return val;
          }
        }
      }

      index = (index + 1) % capacity;
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
    const capacity = this.capacity;
    const buckets = this.buckets;
    const states = this.states;
    const hashes = this.hashes;

    let index = Math.abs(hash % capacity);
    let start_index = index;

    // PRE-ENCODE KEY
    const keyLen = this.keyCodec.byteLength(key);
    if (this.tempKeyBuffer.length < keyLen) {
      this.tempKeyBuffer = Buffer.allocUnsafe(
        Math.max(keyLen, this.tempKeyBuffer.length * 2),
      );
    }
    this.keyCodec.encode(key, this.tempKeyBuffer, 0);

    while (true) {
      const offset = buckets[index];
      if (offset === 0) return false;

      // FAST PATH
      if (states[index] === FLAG_ACTIVE) {
        if (hashes[index] === hash) {
          if (this.keyMatchesPreEncoded(offset, keyLen)) return true;
        }
      }

      index = (index + 1) % capacity;
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
    const capacity = this.capacity;
    const buckets = this.buckets;
    const states = this.states;
    const hashes = this.hashes;

    let index = Math.abs(hash % capacity);
    let start_index = index;

    // PRE-ENCODE KEY
    const keyLen = this.keyCodec.byteLength(key);
    if (this.tempKeyBuffer.length < keyLen) {
      this.tempKeyBuffer = Buffer.allocUnsafe(
        Math.max(keyLen, this.tempKeyBuffer.length * 2),
      );
    }
    this.keyCodec.encode(key, this.tempKeyBuffer, 0);

    while (true) {
      const offset = buckets[index];
      if (offset === 0) return false;

      // FAST PATH
      if (states[index] === FLAG_ACTIVE) {
        if (hashes[index] === hash) {
          if (this.keyMatchesPreEncoded(offset, keyLen)) {
            this.buffer.writeUInt8(FLAG_DELETED, offset);
            states[index] = FLAG_DELETED; // Update state
            this._size--;
            this._deletedCount++;
            this.checkCompaction();
            return true;
          }
        }
      }

      index = (index + 1) % capacity;
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
    this.buckets.fill(0);
    this.hashes.fill(0);
    this.states.fill(0);
    this.writeOffset = 1;
    this._size = 0;
    this._deletedCount = 0; // Add this
  }

  private writeEntry(index: number, key: K, value: V, hash: number) {
    // Calculate size
    const keySize = this.keyCodec.byteLength(key);
    const valSize = this.valueCodec.byteLength(value);

    const keyFixed = this.keyCodec.fixedLength !== undefined;
    const valFixed = this.valueCodec.fixedLength !== undefined;

    // Layout: [Flag(1)] [Hash(4)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
    let entrySize = 5; // Flag + Hash
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
    this.buckets[index] = offset;
    this.hashes[index] = hash;
    this.states[index] = FLAG_ACTIVE;
  }

  private keyMatchesPreEncoded(offset: number, keyLen: number): boolean {
    let cursor = offset + 5; // Skip Flag(1) + Hash(4)

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
    let cursor = offset + 5; // Skip Flag(1) + Hash(4)

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
    let cursor = offset + 5; // Skip Flag(1) + Hash(4)

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

    // Read Val buffer
    const valBuf = this.buffer.readBuffer(cursor, valSize);
    return this.valueCodec.decode(valBuf, 0, valSize);
  }

  /**
   * Returns a new Iterator object that contains the [key, value] pairs for each element in the RogueMap object in insertion order.
   * Note: The order is based on internal buffer layout, which is roughly insertion order but affected by deletions and updates.
   */
  *entries(): IterableIterator<[K, V]> {
    let cursor = 1;
    while (cursor < this.writeOffset) {
      const flag = this.buffer.readUInt8(cursor);

      // Layout: [Flag(1)] [Hash(4)] [KeyLen(4)?] [ValLen(4)?] [Key] [Val]
      let entryLen = 5;

      let keySize: number, valSize: number;
      let kLenSize = 0,
        vLenSize = 0;

      if (this.keyCodec.fixedLength !== undefined) {
        keySize = this.keyCodec.fixedLength;
      } else {
        keySize = this.buffer.readInt32LE(cursor + 5);
        kLenSize = 4;
      }

      if (this.valueCodec.fixedLength !== undefined) {
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
  *keys(): IterableIterator<K> {
    for (const [key] of this.entries()) {
      yield key;
    }
  }

  /**
   * Returns a new Iterator object that contains the values for each element in the RogueMap object.
   */
  *values(): IterableIterator<V> {
    for (const [_, value] of this.entries()) {
      yield value;
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
