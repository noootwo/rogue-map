/**
 * FNV-1a hash function for strings.
 * Fast and provides good distribution for short strings.
 *
 * @param str The string to hash.
 * @returns A 32-bit unsigned integer hash.
 */
export function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
