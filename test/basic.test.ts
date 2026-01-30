import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { Int32Codec } from '../src/codecs';

describe('RogueMap Basic Operations', () => {
  it('should store and retrieve string keys', () => {
    const map = new RogueMap<string, any>();
    map.set('hello', 'world');
    map.set('foo', { bar: 123 });

    expect(map.get('hello')).toBe('world');
    expect(map.get('foo')).toEqual({ bar: 123 });
    expect(map.size).toBe(2);
  });

  it('should return undefined for missing keys', () => {
    const map = new RogueMap();
    map.set('a', 1);
    expect(map.get('b')).toBeUndefined();
  });

  it('should handle updates', () => {
    const map = new RogueMap();
    map.set('a', 1);
    expect(map.get('a')).toBe(1);
    
    map.set('a', 2);
    expect(map.get('a')).toBe(2);
    expect(map.size).toBe(1);
  });

  it('should handle deletes', () => {
    const map = new RogueMap();
    map.set('a', 1);
    expect(map.has('a')).toBe(true);
    
    expect(map.delete('a')).toBe(true);
    expect(map.has('a')).toBe(false);
    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(0);
    
    expect(map.delete('a')).toBe(false);
  });
});

describe('RogueMap with Fixed Size Codecs', () => {
  it('should work with Int32 keys and values', () => {
    const map = new RogueMap<number, number>({
      keyCodec: Int32Codec,
      valueCodec: Int32Codec,
      capacity: 100
    });

    map.set(123, 456);
    expect(map.get(123)).toBe(456);
    
    map.set(123, 789);
    expect(map.get(123)).toBe(789);
  });
});

describe('RogueMap Collision Handling', () => {
  it('should handle collisions correctly', () => {
    // Force small capacity to ensure collisions
    const map = new RogueMap<string, number>({
      capacity: 4, // Very small capacity
      valueCodec: Int32Codec
    });

    // With capacity 4, these are likely to collide or fill up quickly
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4);

    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
    expect(map.get('d')).toBe(4);
  });
});
