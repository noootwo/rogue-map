import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';

describe('RogueMap Standard Interface', () => {
  it('should support iteration via for..of (entries)', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    const entries = [];
    for (const entry of map) {
      entries.push(entry);
    }

    expect(entries.length).toBe(3);
    // Order is insertion order because of linear append to buffer?
    // Wait, linear probing hash map does NOT guarantee insertion order in iteration 
    // IF we iterate buckets.
    // BUT we iterate the buffer! The buffer IS an append-only log.
    // However, when we update, we append a new entry and mark old as deleted.
    // So iteration order is roughly insertion order of the *latest* update.
    // Let's verify this behavior.
    
    expect(entries).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('should support keys()', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    
    const keys = Array.from(map.keys());
    expect(keys).toEqual(['a', 'b']);
  });

  it('should support values()', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    
    const values = Array.from(map.values());
    expect(values).toEqual([1, 2]);
  });

  it('should support forEach', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    
    const result: any[] = [];
    map.forEach((value, key, m) => {
      expect(m).toBe(map);
      result.push([key, value]);
    });
    
    expect(result).toEqual([['a', 1], ['b', 2]]);
  });

  it('should handle clear()', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    
    expect(map.size).toBe(2);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.get('a')).toBeUndefined();
    expect(Array.from(map.entries())).toEqual([]);
    
    // Should be able to reuse after clear
    map.set('c', 3);
    expect(map.size).toBe(1);
    expect(map.get('c')).toBe(3);
  });

  it('should skip deleted items in iteration', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.delete('a');
    
    const entries = Array.from(map.entries());
    expect(entries).toEqual([['b', 2]]);
  });

  it('should show updated items in correct order (latest)', () => {
    const map = new RogueMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.set('a', 3); // Update 'a'
    
    // 'a' (1) is marked DELETED. 'b' (2) is ACTIVE. 'a' (3) is appended.
    // So buffer order is: [DELETED a:1], [ACTIVE b:2], [ACTIVE a:3]
    // Iteration should show: ['b', 2], ['a', 3]
    
    const entries = Array.from(map.entries());
    expect(entries).toEqual([['b', 2], ['a', 3]]);
  });
});
