
import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { StringCodec, Int32Codec } from '../src/codecs';

describe('Optimization Tests', () => {
  describe('Adaptive Key Comparison', () => {
    it('should handle short keys (<48 bytes) correctly', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const shortKey = 'short-key';
      
      map.set(shortKey, 100);
      expect(map.get(shortKey)).toBe(100);
      expect(map.has(shortKey)).toBe(true);
      
      map.delete(shortKey);
      expect(map.has(shortKey)).toBe(false);
      expect(map.get(shortKey)).toBeUndefined();
    });

    it('should handle long keys (>48 bytes) correctly', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const longKey = 'long-key-'.repeat(10); // 9 * 10 = 90 bytes
      
      map.set(longKey, 200);
      expect(map.get(longKey)).toBe(200);
      expect(map.has(longKey)).toBe(true);
      
      map.delete(longKey);
      expect(map.has(longKey)).toBe(false);
      expect(map.get(longKey)).toBeUndefined();
    });

    it('should handle boundary keys (47, 48, 49 bytes) correctly', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const key47 = 'a'.repeat(47);
      const key48 = 'a'.repeat(48);
      const key49 = 'a'.repeat(49);
      
      map.set(key47, 47);
      map.set(key48, 48);
      map.set(key49, 49);
      
      expect(map.get(key47)).toBe(47);
      expect(map.get(key48)).toBe(48);
      expect(map.get(key49)).toBe(49);
      
      // Update
      map.set(key48, 480);
      expect(map.get(key48)).toBe(480);
      
      // Delete
      map.delete(key48);
      expect(map.has(key48)).toBe(false);
      expect(map.has(key47)).toBe(true);
      expect(map.has(key49)).toBe(true);
    });

    it('should handle hash collisions with different key lengths', () => {
      // Force collision by using a custom hasher that returns same hash
      const map = new RogueMap({
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
        hasher: () => 12345 // Always same hash
      });

      const key1 = 'short';
      const key2 = 'long-key-'.repeat(10);
      const key3 = 'medium-key-just-about-right';

      map.set(key1, 1);
      map.set(key2, 2);
      map.set(key3, 3);

      expect(map.get(key1)).toBe(1);
      expect(map.get(key2)).toBe(2);
      expect(map.get(key3)).toBe(3);

      // Verify deletion in collision chain
      map.delete(key2);
      expect(map.has(key2)).toBe(false);
      expect(map.get(key1)).toBe(1);
      expect(map.get(key3)).toBe(3);
    });
  });

  describe('Lazy Decoding Iterators', () => {
    it('keys() should return correct keys', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const count = 100;
      for (let i = 0; i < count; i++) {
        map.set(`k${i}`, i);
      }

      const keys = Array.from(map.keys());
      expect(keys.length).toBe(count);
      for (let i = 0; i < count; i++) {
        expect(keys).toContain(`k${i}`);
      }
    });

    it('values() should return correct values', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const count = 100;
      for (let i = 0; i < count; i++) {
        map.set(`k${i}`, i);
      }

      const values = Array.from(map.values());
      expect(values.length).toBe(count);
      for (let i = 0; i < count; i++) {
        expect(values).toContain(i);
      }
    });

    it('entries() should return correct entries', () => {
      const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
      const count = 100;
      for (let i = 0; i < count; i++) {
        map.set(`k${i}`, i);
      }

      const entries = Array.from(map.entries());
      expect(entries.length).toBe(count);
      for (const [k, v] of entries) {
        expect(Number(k.substring(1))).toBe(v);
      }
    });
    
    it('iterators should work after deletions and updates', () => {
        const map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3);
        
        map.delete('b');
        map.set('a', 10);
        map.set('d', 4);
        
        const keys = Array.from(map.keys());
        expect(keys).toContain('a');
        expect(keys).toContain('c');
        expect(keys).toContain('d');
        expect(keys).not.toContain('b');
        expect(keys.length).toBe(3);
        
        const values = Array.from(map.values());
        expect(values).toContain(10);
        expect(values).toContain(3);
        expect(values).toContain(4);
        expect(values.length).toBe(3);
    });
  });
});
