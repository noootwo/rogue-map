import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';

describe('RogueMap Resizing', () => {
  it('should resize when load factor exceeded', () => {
    const map = new RogueMap({
      capacity: 4,
      initialMemory: 1024
    });
    
    // Fill it up
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.set('d', 4); // Should trigger resize
    map.set('e', 5);

    expect(map.size).toBe(5);
    expect(map.get('a')).toBe(1);
    expect(map.get('e')).toBe(5);
  });

  it('should resize when buffer full', () => {
    const map = new RogueMap({
      capacity: 100,
      initialMemory: 64 // Very small buffer
    });
    
    // 'key1' + 'val1' + overhead > 64? 
    // key 'key1' (4) + val 'val1' (6 with quotes). Overhead 9. Total ~19.
    // 3 items = 57 bytes. 4 items > 64.
    
    map.set('key1', 'val1');
    map.set('key2', 'val2');
    map.set('key3', 'val3');
    map.set('key4', 'val4'); // Should trigger resize
    
    expect(map.size).toBe(4);
    expect(map.get('key1')).toBe('val1');
    expect(map.get('key4')).toBe('val4');
  });
});
