/**
 * MurmurHash3 32-bit hash function implementation.
 * Faster and better distribution than FNV-1a.
 *
 * @param key The string or buffer to hash.
 * @param seed Optional seed value (default 0).
 * @returns A 32-bit unsigned integer hash.
 */
export function murmurHash3(key: string | Buffer, seed: number = 0): number {
  let h1 = seed | 0;
  let k1 = 0;
  let i = 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  const isString = typeof key === "string";
  const len = key.length;
  // If string, we use charCodeAt (UTF-16 mostly, but we treat as bytes for ASCII/UTF8 approximation or manual handling)
  // For simplicity and speed in JS, we process strings char-by-char or using unrolled loop.
  // Note: Standard MurmurHash3 processes 4-byte blocks. JS strings are 2-byte chars.
  // We will treat JS string as raw sequence of 16-bit units for speed, or convert to Buffer?
  // Converting to Buffer is slow. We should hash the string directly.
  
  // Optimized body for 4-byte blocks
  const len4 = len & ~3;
  
  if (isString) {
    for (i = 0; i < len4; i += 4) {
      // Pack 4 chars into integer (taking lower 8 bits of each char for ASCII/UTF8-like behavior)
      // Or pack 2 chars (UTF16)? Let's stick to standard practice: treating string as UTF8 bytes is hard without encoding.
      // Let's treat char codes as values.
      // MurmurHash3 usually works on bytes.
      // Faster: Just mix the char codes.
      
      // Let's stick to FNV-1a for strings if we want extreme simplicity, BUT Murmur is requested.
      // Correct JS Murmur3 for strings often involves encoding.
      // We will implement a variant that hashes the char codes directly to avoid encoding overhead.
      
      k1 =
        (key.charCodeAt(i) & 0xff) |
        ((key.charCodeAt(i + 1) & 0xff) << 8) |
        ((key.charCodeAt(i + 2) & 0xff) << 16) |
        ((key.charCodeAt(i + 3) & 0xff) << 24);

      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }
    
    k1 = 0;
    const rem = len & 3;
    if (rem === 3) {
      k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
      k1 ^= key.charCodeAt(i) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    } else if (rem === 2) {
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
      k1 ^= key.charCodeAt(i) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    } else if (rem === 1) {
      k1 ^= key.charCodeAt(i) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    }
  } else {
    // Buffer
    for (i = 0; i < len4; i += 4) {
      k1 =
        key[i] |
        (key[i + 1] << 8) |
        (key[i + 2] << 16) |
        (key[i + 3] << 24);

      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }
    
    k1 = 0;
    const rem = len & 3;
    if (rem === 3) {
      k1 ^= key[i + 2] << 16;
      k1 ^= key[i + 1] << 8;
      k1 ^= key[i];
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    } else if (rem === 2) {
      k1 ^= key[i + 1] << 8;
      k1 ^= key[i];
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    } else if (rem === 1) {
      k1 ^= key[i];
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    }
  }

  // Finalization
  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Thomas Wang's 32-bit integer mix hash function.
 * Optimized for hashing numbers.
 *
 * @param num The number to hash.
 * @returns A 32-bit unsigned integer hash.
 */
export function numberHash(num: number): number {
  // Simple integer hash or just return the number if it fits 32-bit (but distribution matters)
  // Thomas Wang's 32-bit integer mix function
  num = ~num + (num << 15);
  num = num ^ (num >>> 12);
  num = num + (num << 2);
  num = num ^ (num >>> 4);
  num = Math.imul(num, 2057);
  num = num ^ (num >>> 16);
  return num >>> 0;
}
