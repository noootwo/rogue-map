import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { Int32Codec } from '../src/codecs';

describe('RogueMap Fuzz Testing', () => {
  it('should maintain consistency with native Map over 10,000 random operations', () => {
    const rogue = new RogueMap<string, number>({
      valueCodec: Int32Codec,
      capacity: 100, // Small capacity to force frequent resizes
      initialMemory: 1024 // Small memory to force buffer resizes
    });
    const native = new Map<string, number>();

    const OPERATIONS = 10_000;
    const KEY_SPACE = 500; // 500 unique keys to ensure collisions and overwrites

    for (let i = 0; i < OPERATIONS; i++) {
      const op = Math.random();
      const key = `key_${Math.floor(Math.random() * KEY_SPACE)}`;
      const val = Math.floor(Math.random() * 10000);

      if (op < 0.6) {
        // SET (60%)
        rogue.set(key, val);
        native.set(key, val);
      } else if (op < 0.8) {
        // DELETE (20%)
        const rDel = rogue.delete(key);
        const nDel = native.delete(key);
        // Expect delete success/fail to match
        if (rDel !== nDel) {
            throw new Error(`Delete mismatch at op ${i} for key ${key}: Rogue=${rDel}, Native=${nDel}`);
        }
      } else {
        // GET (20%)
        const rVal = rogue.get(key);
        const nVal = native.get(key);
        if (rVal !== nVal) {
            throw new Error(`Get mismatch at op ${i} for key ${key}: Rogue=${rVal}, Native=${nVal}`);
        }
      }

      // Periodically check size
      if (i % 1000 === 0) {
        expect(rogue.size).toBe(native.size);
      }
      
      // Periodically compact
      if (i % 2000 === 0) {
          rogue.compact();
          // Verify size again after compaction
          expect(rogue.size).toBe(native.size);
      }
    }

    // Final check
    expect(rogue.size).toBe(native.size);
    native.forEach((v, k) => {
        expect(rogue.get(k)).toBe(v);
    });
  });
});
