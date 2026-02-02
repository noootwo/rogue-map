
import { describe, it, expect } from "vitest";
import { RogueMap } from "../src/RogueMap";

describe("RogueMap Async Iterators", () => {
  it("should iterate entries asynchronously without blocking", async () => {
    const map = new RogueMap<string, number>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      map.set(`key${i}`, i);
    }

    let iteratedCount = 0;
    const start = Date.now();

    // Iterate with small batch size to force yields
    for await (const [key, value] of map.asyncEntries(10)) {
      expect(key).toBe(`key${value}`);
      iteratedCount++;
    }

    expect(iteratedCount).toBe(count);
    // Note: We can't easily assert "non-blocking" in unit test without complex timing,
    // but we can verify correctness and that it runs.
  });

  it("should handle empty map", async () => {
    const map = new RogueMap<string, number>();
    let count = 0;
    for await (const _ of map.asyncEntries()) {
      count++;
    }
    expect(count).toBe(0);
  });
});
