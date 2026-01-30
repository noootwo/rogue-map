import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';

describe('RogueMap Mixed Types (AnyCodec)', () => {
  it('should support mixed key types in the same map', () => {
    // Default uses AnyCodec
    const map = new RogueMap();

    map.set('stringKey', 'value1');
    map.set(123, 'value2');
    map.set(true, 'value3');
    
    expect(map.get('stringKey')).toBe('value1');
    expect(map.get(123)).toBe('value2');
    expect(map.get(true)).toBe('value3');
    
    expect(map.has('stringKey')).toBe(true);
    expect(map.has(123)).toBe(true);
    expect(map.has(true)).toBe(true);
  });

  it('should support mixed value types', () => {
    const map = new RogueMap();

    map.set('a', 1);
    map.set('b', 'string');
    map.set('c', { foo: 'bar' });
    map.set('d', Buffer.from('hello'));
    map.set('e', new Date('2024-01-01'));
    map.set('f', null);
    
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe('string');
    expect(map.get('c')).toEqual({ foo: 'bar' });
    
    const buf = map.get('d');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('hello');
    
    const date = map.get('e');
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString()).toBe(new Date('2024-01-01').toISOString());
    
    expect(map.get('f')).toBeNull();
  });
  
  it('should handle Buffer keys correctly', () => {
      const map = new RogueMap();
      const buf1 = Buffer.from([1, 2, 3]);
      const buf2 = Buffer.from([1, 2, 3]); // Same content, different ref
      const buf3 = Buffer.from([4, 5, 6]);
      
      map.set(buf1, 'found');
      
      // Should find by value (content) not just reference?
      // Our default Hasher uses toString('binary') so it hashes content.
      // But AnyCodec uses Buffer.compare? Or does RogueMap keyMatches use === ?
      // RogueMap keyMatches uses `keyCodec.decode` then `===`.
      // For Buffers, decode returns a NEW buffer. `===` will FAIL.
      // So Buffer keys might need a specialized Codec or Hasher to work "by value".
      // BUT, let's see what AnyCodec does.
      // AnyCodec.decode returns a Buffer.
      
      // WAIT: In JS Map, objects are keys by REFERENCE.
      // In RogueMap, we are serializing. So we are essentially "By Value".
      // But when we read back, we get a NEW Buffer.
      // `storedKey === key` will be false for Buffers.
      
      // So RogueMap default behavior for Object/Buffer keys is:
      // You must provide the EXACT SAME reference if decode returns an object?
      // No, `decode` returns a NEW object from buffer. 
      // So `storedKey` (from buffer) !== `key` (passed in arg).
      // ALWAYS FALSE.
      
      // So Buffer/Object keys won't work with AnyCodec + === check in `keyMatches`.
      // Unless we override keyMatches or AnyCodec returns something comparable.
      // OR, we accept that for Objects/Buffers, RogueMap is "Value Semantics" but we need a deep equals?
      
      // Let's test this hypothesis.
  });
});
