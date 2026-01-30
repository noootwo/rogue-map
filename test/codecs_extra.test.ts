import { describe, it, expect } from 'vitest';
import { RogueMap } from '../src/RogueMap';
import { AnyCodec, BooleanCodec, DateCodec, BigInt64Codec, BufferCodec } from '../src/codecs';

describe('RogueMap Extra Codecs', () => {
  it('should support Boolean', () => {
    const map = new RogueMap<string, boolean>({
      valueCodec: BooleanCodec
    });
    
    map.set('t', true);
    map.set('f', false);
    
    expect(map.get('t')).toBe(true);
    expect(map.get('f')).toBe(false);
  });

  it('should support Date', () => {
    const map = new RogueMap<string, Date>({
      valueCodec: DateCodec
    });
    
    const now = new Date();
    map.set('now', now);
    
    const retrieved = map.get('now');
    expect(retrieved).toEqual(now);
    expect(retrieved).not.toBe(now); // Should be a new instance
  });

  it('should support BigInt', () => {
    const map = new RogueMap<string, bigint>({
      valueCodec: BigInt64Codec
    });
    
    const big = BigInt("9007199254740991000");
    map.set('big', big);
    
    expect(map.get('big')).toBe(big);
  });

  it('should support Buffer', () => {
    const map = new RogueMap<string, Buffer>({
      valueCodec: BufferCodec
    });
    
    const buf = Buffer.from('hello world');
    map.set('buf', buf);
    
    const retrieved = map.get('buf');
    expect(retrieved?.toString()).toBe('hello world');
    expect(Buffer.isBuffer(retrieved)).toBe(true);
  });

  it('should support AnyCodec (Mixed Types)', () => {
    const map = new RogueMap<string, any>({
      valueCodec: AnyCodec
    });
    
    const date = new Date();
    const buf = Buffer.from('buffer');
    
    map.set('null', null);
    map.set('bool', true);
    map.set('int', 12345);
    map.set('float', 123.456);
    map.set('str', 'hello');
    map.set('date', date);
    map.set('bigint', 100n);
    map.set('buffer', buf);
    map.set('obj', { a: 1 }); // Fallback to JSON
    
    expect(map.get('null')).toBe(null);
    expect(map.get('bool')).toBe(true);
    expect(map.get('int')).toBe(12345);
    expect(map.get('float')).toBeCloseTo(123.456);
    expect(map.get('str')).toBe('hello');
    expect(map.get('date')).toEqual(date);
    expect(map.get('bigint')).toBe(100n);
    expect(map.get('buffer')).toEqual(buf);
    expect(map.get('obj')).toEqual({ a: 1 });
  });
});
