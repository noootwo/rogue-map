
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RogueMap } from "../src/RogueMap";

describe("RogueMap Events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should emit 'set' event", () => {
    const map = new RogueMap<string, string>();
    const onSet = vi.fn();
    map.on("set", onSet);

    map.set("key1", "value1");
    expect(onSet).toHaveBeenCalledWith("key1", "value1");
  });

  it("should emit 'delete' event", () => {
    const map = new RogueMap<string, string>();
    const onDelete = vi.fn();
    map.on("delete", onDelete);

    map.set("key1", "value1");
    map.delete("key1");
    expect(onDelete).toHaveBeenCalledWith("key1");
  });

  it("should emit 'clear' event", () => {
    const map = new RogueMap<string, string>();
    const onClear = vi.fn();
    map.on("clear", onClear);

    map.set("key1", "value1");
    map.clear();
    expect(onClear).toHaveBeenCalled();
  });

  it("should emit 'evict' event when cache is full", () => {
    const map = new RogueMap<string, string>({
      cacheSize: 2, // Small cache
    });
    const onEvict = vi.fn();
    map.on("evict", onEvict);

    map.set("k1", "v1");
    map.set("k2", "v2");
    // Cache: k1, k2. Size 2.
    // Next set should evict k1 (oldest)
    map.set("k3", "v3");

    expect(onEvict).toHaveBeenCalledWith("k1", "v1");
  });

  it("should emit 'expire' event on get() lazy delete", () => {
    const map = new RogueMap<string, string>({ ttl: 100 });
    const onExpire = vi.fn();
    map.on("expire", onExpire);

    map.set("k1", "v1");
    vi.advanceTimersByTime(200);

    // Trigger lazy delete
    map.get("k1");

    expect(onExpire).toHaveBeenCalledWith("k1");
  });

  it("should emit 'expire' event on compact()", () => {
    const map = new RogueMap<string, string>({
      compaction: { minSize: 0, threshold: 0.1 },
      ttl: 100,
    });
    const onExpire = vi.fn();
    map.on("expire", onExpire);

    map.set("k1", "v1");
    vi.advanceTimersByTime(200);

    // Trigger compaction manually
    map.compact();

    expect(onExpire).toHaveBeenCalledWith("k1");
  });

  it("should emit 'expire' event on delete() lazy check", () => {
    const map = new RogueMap<string, string>({ ttl: 100 });
    const onExpire = vi.fn();
    map.on("expire", onExpire);

    map.set("k1", "v1");
    vi.advanceTimersByTime(200);

    // Trigger delete, which checks expiry first
    const deleted = map.delete("k1");
    expect(deleted).toBe(false); // Should return false as it's expired/not found active
    expect(onExpire).toHaveBeenCalledWith("k1");
  });
});
