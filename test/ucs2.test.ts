
import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { UCS2StringCodec, Int32Codec, StringCodec } from '../src/codecs';

describe('UCS2StringCodec Tests', () => {
  it('should encode and decode strings correctly', () => {
    const map = new RogueMap({ keyCodec: UCS2StringCodec, valueCodec: Int32Codec });
    const keys = ['hello', 'world', '测试', '🚀'];
    
    keys.forEach((key, index) => {
      map.set(key, index);
    });

    keys.forEach((key, index) => {
      expect(map.get(key)).toBe(index);
    });
  });

  it('should handle updates and deletes', () => {
    const map = new RogueMap({ keyCodec: UCS2StringCodec, valueCodec: Int32Codec });
    const key = 'dynamic-key';
    
    map.set(key, 100);
    expect(map.get(key)).toBe(100);
    expect(map.has(key)).toBe(true);
    
    map.set(key, 200);
    expect(map.get(key)).toBe(200);
    
    map.delete(key);
    expect(map.has(key)).toBe(false);
    expect(map.get(key)).toBeUndefined();
  });

  it('should work with iterators', () => {
    const map = new RogueMap({ keyCodec: UCS2StringCodec, valueCodec: Int32Codec });
    map.set('a', 1);
    map.set('b', 2);
    
    const keys = Array.from(map.keys());
    expect(keys).toContain('a');
    expect(keys).toContain('b');
  });

  it('should have correct byteLength', () => {
    expect(UCS2StringCodec.byteLength('abc')).toBe(6);
    expect(UCS2StringCodec.byteLength('测试')).toBe(4); // 2 chars * 2 bytes = 4
    // Note: Emoji 🚀 is 2 chars (surrogate pair) in JS string
    expect(UCS2StringCodec.byteLength('🚀')).toBe(4);
  });
});

describe('UCS2 vs UTF8 Benchmark (Mini)', () => {
    it('should be functional', () => {
        const ucs2Map = new RogueMap({ keyCodec: UCS2StringCodec, valueCodec: Int32Codec });
        const utf8Map = new RogueMap({ keyCodec: StringCodec, valueCodec: Int32Codec });
        
        const key = "benchmark-key";
        ucs2Map.set(key, 1);
        utf8Map.set(key, 1);
        
        expect(ucs2Map.get(key)).toBe(1);
        expect(utf8Map.get(key)).toBe(1);
    });
});
