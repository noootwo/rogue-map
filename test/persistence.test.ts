import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { saveSync, loadSync, save, load } from '../src/persistence';
import * as fs from 'fs';
import * as path from 'path';

const TEMP_FILE = path.join(__dirname, 'temp_map.bin');

describe('RogueMap Persistence & Compaction', () => {
  beforeEach(() => {
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  });

  it('should compact buffer by removing deleted entries', () => {
    const map = new RogueMap<string, number>({
      capacity: 100,
      initialMemory: 1024
    });

    // Add entries
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    
    // Delete 'b'
    map.delete('b');
    
    // Update 'a' (appends new entry)
    map.set('a', 10);
    
    // Before compaction: 
    // [a:1 (del)], [b:2 (del)], [c:3], [a:10]
    // Compaction should remove 'a:1' and 'b:2'.
    
    map.compact();
    
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(10);
    expect(map.get('c')).toBe(3);
    expect(map.get('b')).toBeUndefined();
  });

  it('should serialize and deserialize correctly', () => {
    const map = new RogueMap<string, number>();
    map.set('hello', 123);
    map.set('world', 456);
    
    const buffer = map.serialize();
    
    const restored = RogueMap.deserialize(buffer);
    
    expect(restored.size).toBe(2);
    expect(restored.get('hello')).toBe(123);
    expect(restored.get('world')).toBe(456);
  });

  it('should save and load synchronously', () => {
    const map = new RogueMap<string, number>();
    map.set('foo', 1);
    map.set('bar', 2);
    
    saveSync(map, TEMP_FILE);
    
    const loaded = loadSync<string, number>(TEMP_FILE);
    
    expect(loaded.size).toBe(2);
    expect(loaded.get('foo')).toBe(1);
    expect(loaded.get('bar')).toBe(2);
  });

  it('should save and load asynchronously', async () => {
    const map = new RogueMap<string, number>();
    map.set('async', 999);
    
    await save(map, TEMP_FILE);
    
    const loaded = await load<string, number>(TEMP_FILE);
    
    expect(loaded.size).toBe(1);
    expect(loaded.get('async')).toBe(999);
  });
});
