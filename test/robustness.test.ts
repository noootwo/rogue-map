
import { describe, it, expect } from "vitest";
import { RogueMap } from "../src/RogueMap";

describe("RogueMap Robustness", () => {
  it("should handle hash collisions correctly", () => {
    // Force collision by returning same hash
    const map = new RogueMap<string, string>({
      hasher: () => 1,
      capacity: 16,
    });

    map.set("key1", "value1");
    map.set("key2", "value2");
    map.set("key3", "value3");

    // All should be retrievable despite same hash
    expect(map.get("key1")).toBe("value1");
    expect(map.get("key2")).toBe("value2");
    expect(map.get("key3")).toBe("value3");
    expect(map.size).toBe(3);

    // Delete middle one
    map.delete("key2");
    expect(map.get("key1")).toBe("value1");
    expect(map.get("key2")).toBeUndefined();
    expect(map.get("key3")).toBe("value3");
    expect(map.size).toBe(2);

    // Add new one (should also collide)
    map.set("key4", "value4");
    expect(map.get("key1")).toBe("value1");
    expect(map.get("key3")).toBe("value3");
    expect(map.get("key4")).toBe("value4");
  });

  it("should resize correctly when load factor exceeded", () => {
    const initialCap = 16;
    const map = new RogueMap<string, number>({
      capacity: initialCap,
    });

    // Fill to > 75% (12 items)
    const count = 15;
    for (let i = 0; i < count; i++) {
      map.set(`k${i}`, i);
    }

    // Capacity should have doubled
    // We can't check private capacity directly easily, but we can infer from behavior or assume successful if no error
    // However, if resize failed, we might have lost data or thrown error.
    
    // Verify all items
    for (let i = 0; i < count; i++) {
      expect(map.get(`k${i}`)).toBe(i);
    }
    
    expect(map.size).toBe(count);
  });

  it("should handle large number of operations", () => {
    const map = new RogueMap<number, number>();
    const count = 10000;
    
    // Write
    for (let i = 0; i < count; i++) {
      map.set(i, i * 2);
    }
    
    // Read
    for (let i = 0; i < count; i++) {
      expect(map.get(i)).toBe(i * 2);
    }
    
    // Delete half
    for (let i = 0; i < count; i += 2) {
      map.delete(i);
    }
    
    // Verify
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        expect(map.has(i)).toBe(false);
      } else {
        expect(map.get(i)).toBe(i * 2);
      }
    }
  });

  it("should support mixed key types if hasher handles them", () => {
    const map = new RogueMap<any, any>();
    
    map.set("str", 1);
    map.set(123, "num");
    map.set(Buffer.from("buf"), "buffer");
    
    expect(map.get("str")).toBe(1);
    expect(map.get(123)).toBe("num");
    // Buffer key equality depends on codec and lookup
    // Default AnyCodec handles Buffer via JSON/String? 
    // Wait, AnyCodec uses JSON.stringify. JSON.stringify(Buffer) is {type:'Buffer', data:...}
    // So looking up with new Buffer('buf') creates same JSON string.
    expect(map.get(Buffer.from("buf"))).toBe("buffer");
  });
});
