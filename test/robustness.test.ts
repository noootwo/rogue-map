import { describe, it, expect } from "vitest";
import { RogueMap } from "../src/RogueMap";
import { Int32Codec, BufferCodec } from "../src/codecs";

describe("RogueMap Robustness & Edge Cases", () => {
  describe("Hash Collisions (Forced)", () => {
    // Mock hasher that causes collisions
    const badHasher = (key: string) => {
      // Return same hash for 'a' and 'b' to force collision
      if (key === "a" || key === "b") return 100;
      // Return same hash for 'c' and 'd'
      if (key === "c" || key === "d") return 200;
      return 0;
    };

    it("should handle direct collisions correctly", () => {
      // We need to access the private hasher or pass it via options if possible.
      // Currently RogueMap doesn't expose hasher in options cleanly for testing,
      // but we can extend the class or modify the instance (JS allows it).

      const map = new RogueMap<string, number>({
        capacity: 10,
        valueCodec: Int32Codec,
      });

      // Monkey-patch hasher
      (map as any).hasher = badHasher;

      map.set("a", 1); // Hash 100, Bucket 0 (100 % 10)
      map.set("b", 2); // Hash 100, Bucket 0 -> Collision -> Probe

      expect(map.get("a")).toBe(1);
      expect(map.get("b")).toBe(2);

      // Internal check: They should be in adjacent slots (conceptually)
      // We can't easily check internal slots without exposing private vars,
      // but behavior correctness is what matters.
    });

    it("should handle delete in collision chain", () => {
      const map = new RogueMap<string, number>({
        capacity: 10,
        valueCodec: Int32Codec,
      });
      (map as any).hasher = badHasher;

      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);

      // Chain for hash 100: [a, b]
      // Delete 'a' (head of chain)
      expect(map.delete("a")).toBe(true);

      // 'b' should still be found
      expect(map.get("b")).toBe(2);
      expect(map.has("a")).toBe(false);

      // Re-insert 'a', should reuse slot or work correctly
      map.set("a", 10);
      expect(map.get("a")).toBe(10);
      expect(map.get("b")).toBe(2);
    });

    it('should handle "sandwich" deletion', () => {
      // A -> B -> C (all collide)
      // Delete B
      // Get C (should probe past deleted B)
      const map = new RogueMap<string, number>({
        capacity: 10,
        valueCodec: Int32Codec,
      });
      (map as any).hasher = () => 1; // EVERYTHING collides

      map.set("1", 1);
      map.set("2", 2);
      map.set("3", 3);

      expect(map.delete("2")).toBe(true);

      expect(map.get("1")).toBe(1);
      expect(map.get("3")).toBe(3);
      expect(map.has("2")).toBe(false);
    });
  });

  describe("Buffer & Capacity Boundaries", () => {
    it("should auto-resize when buffer is full even if capacity is not", () => {
      // Small buffer, large capacity
      const map = new RogueMap<string, string>({
        capacity: 100,
        initialMemory: 100, // Tiny buffer
      });

      // Insert until buffer full
      // Each entry overhead: 5 (header) + 4 (keylen) + 4 (vallen) = 13 bytes
      // Key "k" (1 byte), Value "v" (1 byte) = 15 bytes per entry.
      // 100 bytes can hold ~6 entries.

      for (let i = 0; i < 20; i++) {
        map.set(`k${i}`, `v${i}`);
      }

      expect(map.size).toBe(20);
      // It should have resized the buffer internally
      // We verify by reading back
      for (let i = 0; i < 20; i++) {
        expect(map.get(`k${i}`)).toBe(`v${i}`);
      }
    });

    it("should handle large values causing immediate resize", () => {
      const map = new RogueMap<string, Buffer>({
        initialMemory: 1024,
        valueCodec: BufferCodec,
      });

      const largeBuf = Buffer.alloc(2048); // Bigger than initial memory
      largeBuf.fill(1);

      map.set("big", largeBuf);

      const retrieved = map.get("big");
      expect(retrieved?.length).toBe(2048);
      expect(retrieved?.equals(largeBuf)).toBe(true);
    });
  });

  describe("Tombstone Reuse", () => {
    it("should reuse deleted slots to prevent infinite growth", () => {
      // Fixed capacity, no auto-resize for this test (we want to fill it)
      // But RogueMap auto-resizes. We can monitor capacity.

      const map = new RogueMap<string, number>({
        capacity: 10,
        initialMemory: 4096,
        // We want to see if it DOESN'T resize if we keep deleting
      });

      // Fill and delete repeatedly
      // If tombstone reuse works, we shouldn't trigger "Hash table full" or massive resizing
      // (assuming load factor logic accounts for deletions correctly)

      for (let i = 0; i < 1000; i++) {
        map.set("temp", i);
        map.delete("temp");
      }

      // Final state
      expect(map.size).toBe(0);

      // Also verify with multiple keys
      map.set("a", 1);
      map.delete("a");
      map.set("a", 2); // Should likely reuse
      expect(map.get("a")).toBe(2);
    });
  });
});
