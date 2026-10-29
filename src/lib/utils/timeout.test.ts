// src/lib/utils/timeout.test.ts

import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "./timeout.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("withTimeout", () => {
    it("settles with the work when it finishes first", async () => {
        await expect(withTimeout(Promise.resolve("done"), 1_000, () => new Error("late"))).resolves.toBe("done");
        await expect(withTimeout(Promise.reject(new Error("own")), 1_000, () => new Error("late"))).rejects.toThrow("own");
    });

    it("rejects with the caller's error when the time passes first", async () => {
        vi.useFakeTimers();
        const pending = withTimeout(new Promise(() => undefined), 50, () => new Error("late"));
        vi.advanceTimersByTime(50);
        await expect(pending).rejects.toThrow("late");
    });

    it("leaves no timer behind", async () => {
        vi.useFakeTimers();
        await withTimeout(Promise.resolve(1), 1_000, () => new Error("late"));
        expect(vi.getTimerCount()).toBe(0);
    });
});
