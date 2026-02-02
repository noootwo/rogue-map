
import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { defineStruct } from '../src/struct';
import { Int32Codec } from '../src/codecs';

describe('StructCodec Tests', () => {
  // Define a User Struct
  const UserStruct = defineStruct({
    id: 'int32',
    score: 'float64',
    active: 'boolean',
    name: 'string(20)'
  });

  it('should encode and decode struct correctly', () => {
    const map = new RogueMap({ valueCodec: UserStruct });
    const user = { id: 1, score: 99.5, active: true, name: 'Alice' };
    
    map.set('u1', user);
    
    const retrieved = map.get('u1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(1);
    expect(retrieved!.score).toBe(99.5);
    expect(retrieved!.active).toBe(true);
    expect(retrieved!.name).toBe('Alice');
  });

  it('should handle zero-copy lazy access', () => {
    // This is hard to prove without mocking Buffer, but behaviorally:
    const map = new RogueMap({ valueCodec: UserStruct });
    map.set('u1', { id: 123, score: 1.23, active: false, name: 'Lazy' });
    
    const obj = map.get('u1')!;
    // The object should be a Proxy
    // Check basic property access
    expect(obj.id).toBe(123);
    
    // Check toJSON serialization
    const json = JSON.stringify(obj);
    expect(JSON.parse(json)).toEqual({
      id: 123, score: 1.23, active: false, name: 'Lazy'
    });
  });

  it('should handle fixed string truncation and padding', () => {
    const map = new RogueMap({ valueCodec: UserStruct });
    
    // String longer than 20 chars
    const longName = 'This name is definitely longer than twenty characters';
    map.set('long', { id: 1, score: 0, active: true, name: longName });
    
    const r1 = map.get('long')!;
    expect(r1.name.length).toBe(20);
    expect(r1.name).toBe(longName.substring(0, 20)); // Buffer.write behavior (utf8 truncates byte-wise, but here ascii)

    // Short string (padded)
    map.set('short', { id: 2, score: 0, active: true, name: 'Bob' });
    const r2 = map.get('short')!;
    expect(r2.name).toBe('Bob'); // Nulls stripped
  });

  it('should support all field types', () => {
    const AllTypes = defineStruct({
      i8: 'int8',
      u8: 'uint8',
      i16: 'int16',
      u16: 'uint16',
      i32: 'int32',
      u32: 'uint32',
      f64: 'float64',
      bool: 'boolean'
    });

    const map = new RogueMap({ valueCodec: AllTypes });
    const data = {
      i8: -10, u8: 200,
      i16: -3000, u16: 60000,
      i32: -100000, u32: 4000000000,
      f64: 3.14159,
      bool: true
    };

    map.set('k', data);
    const res = map.get('k')!;

    expect(res.i8).toBe(-10);
    expect(res.u8).toBe(200);
    expect(res.i16).toBe(-3000);
    expect(res.u16).toBe(60000);
    expect(res.i32).toBe(-100000);
    expect(res.u32).toBe(4000000000);
    expect(res.f64).toBeCloseTo(3.14159);
    expect(res.bool).toBe(true);
  });
  
  it('should support in-place updates', () => {
      const map = new RogueMap({ valueCodec: UserStruct });
      map.set('u1', { id: 1, score: 100, active: true, name: 'Original' });
      
      const obj = map.get('u1')!;
      expect(obj.id).toBe(1);

      // Modify in-place
      obj.id = 2;
      obj.score = 200.5;
      obj.name = 'Modified';

      // Read back from a NEW view to verify persistence in buffer
      const obj2 = map.get('u1')!;
      expect(obj2.id).toBe(2);
      expect(obj2.score).toBe(200.5);
      expect(obj2.name).toBe('Modified');
  });
});
