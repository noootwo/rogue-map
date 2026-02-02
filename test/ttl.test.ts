import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RogueMap } from "../src/RogueMap";

describe("RogueMap TTL Support", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should respect default TTL", () => {
    const map = new RogueMap<string, string>({ ttl: 1000 }); // 1 second TTL

    map.set("key1", "value1");
    expect(map.get("key1")).toBe("value1");

    // Advance time by 500ms
    vi.advanceTimersByTime(500);
    expect(map.get("key1")).toBe("value1");

    // Advance time by another 501ms
    vi.advanceTimersByTime(501);
    expect(map.get("key1")).toBeUndefined();
    expect(map.has("key1")).toBe(false);
  });

  it("should respect per-entry TTL override", () => {
    const map = new RogueMap<string, string>({ ttl: 1000 });

    map.set("default", "val1");
    map.set("long", "val2", { ttl: 5000 });
    map.set("short", "val3", { ttl: 100 });

    // Initial check
    expect(map.get("default")).toBe("val1");
    expect(map.get("long")).toBe("val2");
    expect(map.get("short")).toBe("val3");

    // After 200ms
    vi.advanceTimersByTime(200);
    expect(map.get("default")).toBe("val1");
    expect(map.get("long")).toBe("val2");
    expect(map.get("short")).toBeUndefined();

    // After 1200ms (total)
    vi.advanceTimersByTime(1000);
    expect(map.get("default")).toBeUndefined();
    expect(map.get("long")).toBe("val2");

    // After 5200ms (total)
    vi.advanceTimersByTime(4000);
    expect(map.get("long")).toBeUndefined();
  });

  it("should filter expired items from iterators", () => {
    const map = new RogueMap<string, string>();

    map.set("active1", "v1");
    map.set("expired1", "v2", { ttl: 100 });
    map.set("active2", "v3");

    vi.advanceTimersByTime(200);

    const keys = Array.from(map.keys());
    const values = Array.from(map.values());
    const entries = Array.from(map.entries());

    expect(keys).toEqual(expect.arrayContaining(["active1", "active2"]));
    expect(keys).not.toContain("expired1");
    expect(keys.length).toBe(2);

    expect(values).toEqual(expect.arrayContaining(["v1", "v3"]));
    expect(values).not.toContain("v2");

    expect(entries.length).toBe(2);
  });

  it("should remove expired items during compaction", () => {
    const map = new RogueMap<string, string>({
      compaction: { minSize: 0, threshold: 0.1 }, // Force compaction easily
    });

    // Fill with items
    map.set("k1", "v1", { ttl: 100 });
    map.set("k2", "v2", { ttl: 100 });
    map.set("k3", "v3"); // No expiry

    vi.advanceTimersByTime(200);

    // Trigger compaction manually or via checkCompaction
    // Calling delete to trigger checkCompaction?
    // Or just call compact() directly
    map.compact();

    // Check internal size (should be 1)
    expect(map.size).toBe(1);
    expect(map.get("k3")).toBe("v3");

    // Check that we can't find k1/k2 even in raw buffer if we could peek (implementation detail)
    // But logically, size should update.
  });
});
