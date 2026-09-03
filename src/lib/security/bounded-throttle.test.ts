// src/lib/security/bounded-throttle.test.ts
import { describe, it, expect, vi } from "vitest";
import { setBounded } from "./bounded-throttle.js";
import { THROTTLE } from "../config/session.js";

const MAX = THROTTLE.MAX_TRACKED_KEYS;

function fill(map: Map<string, number>, count: number, prune = () => {}): void {
    for (let i = 0; i < count; i++) {
        setBounded(map, `key-${i}`, i, prune);
    }
}

describe("setBounded", () => {
    it("never exceeds the cap, however many distinct keys arrive", () => {
        const map = new Map<string, number>();
        fill(map, MAX + 500);
        expect(map.size).toBe(MAX);
    });

    it("evicts the first-inserted key, not the least-recently-set", () => {
        const map = new Map<string, number>();
        fill(map, MAX);
        // Re-set the oldest key. `Map` keeps its original position, so it must
        // still be the eviction victim — this is the documented trade.
        setBounded(map, "key-0", 999, () => {});
        expect(map.get("key-0")).toBe(999);

        setBounded(map, "overflow", 1, () => {});
        expect(map.has("key-0")).toBe(false);
        expect(map.has("overflow")).toBe(true);
        expect(map.size).toBe(MAX);
    });

    it("does not evict a bystander when the key is already present", () => {
        const map = new Map<string, number>();
        fill(map, MAX);
        const before = [...map.keys()];

        setBounded(map, "key-5", 42, () => {
            throw new Error("prune must not run for an existing key");
        });

        expect(map.size).toBe(MAX);
        expect([...map.keys()]).toEqual(before);
        expect(map.get("key-5")).toBe(42);
    });

    it("tries the caller's expiry sweep before evicting anything", () => {
        const map = new Map<string, number>();
        fill(map, MAX);
        const prune = vi.fn(() => {
            map.delete("key-0");
        });

        setBounded(map, "fresh", 1, prune);

        expect(prune).toHaveBeenCalledTimes(1);
        // The sweep made room, so no first-inserted key was dropped beyond it.
        expect(map.has("key-1")).toBe(true);
        expect(map.has("fresh")).toBe(true);
        expect(map.size).toBe(MAX);
    });

    it("still bounds the map when the sweep frees nothing", () => {
        const map = new Map<string, number>();
        fill(map, MAX);
        const prune = vi.fn();

        setBounded(map, "fresh", 1, prune);

        expect(prune).toHaveBeenCalledTimes(1);
        expect(map.size).toBe(MAX);
        expect(map.has("fresh")).toBe(true);
    });
});
