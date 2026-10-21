// src/lib/security/rate-limiter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    checkRateLimits,
    clearRateLimitMaps,
    installHostRateLimit,
    rateLimitMapSizes,
    releaseHostRateLimit,
    type HostRateLimitHandle,
    startRateLimitCleanup,
    stopRateLimitCleanup,
} from "./rate-limiter.js";
import { RATE_LIMIT } from "../config/session.js";

const CAP = RATE_LIMIT.MAX_TRACKED_KEYS;

// Fewer requests per client than its quota, so the client gate never fires
// while a case is filling the HOST map. Rotating the client id on every call
// saturates the client gate first and leaves the host cap unreached — the host
// map peaks below CAP and its refusal branch never runs.
const PER_CLIENT = RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE - 50;

beforeEach(() => {
    clearRateLimitMaps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
    clearRateLimitMaps();
});

/** One admitted request against a fresh host, sharing clients in blocks. */
function admitHost(i: number): void {
    checkRateLimits(`host-${i}.example.test`, `client-${Math.floor(i / PER_CLIENT)}`);
}

/** Fill the host map to exactly CAP, asserting nothing was refused on the way. */
function fillHostMapToCap(): void {
    for (let i = 0; i < CAP; i++) admitHost(i);
    expect(rateLimitMapSizes().hosts).toBe(CAP);
}

describe("checkRateLimits — quotas", () => {
    it("throws once a host passes its per-minute ceiling", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits("target.example.test", `client-${i}`);
        }
        expect(() => checkRateLimits("target.example.test", "client-final"))
            .toThrow(/Rate limit exceeded for host/);
    });

    it("throws once a client passes its per-minute ceiling", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "one-client");
        }
        expect(() => checkRateLimits("another.example.test", "one-client"))
            .toThrow(/Client rate limit exceeded/);
    });
});

describe("checkRateLimits — tracking capacity", () => {
    // Nothing starts the cleanup interval here, which is the embedder's
    // situation: `registerEndpointTools` and `executeCurlRequest` are exported
    // and neither starts it. The cap at the write is the only bound.

    it("stops at exactly the cap and says why", () => {
        fillHostMapToCap();
        expect(() => checkRateLimits("one-too-many.example.test", "client-0"))
            .toThrow(/tracking is at capacity .* Refusing an untracked host/);
        expect(rateLimitMapSizes().hosts).toBe(CAP);
    });

    it("refuses an untracked key rather than evicting a tracked one", () => {
        // The victim is the FIRST key inserted, so under an evicting policy it
        // is exactly `map.keys().next().value` and is the first thing dropped —
        // its counter would restart at 1 and this case would not throw.
        const victim = "victim.example.test";
        checkRateLimits(victim, "victim-client");
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE - 2; i++) {
            checkRateLimits(victim, "victim-client");
        }

        for (let i = 0; i < CAP; i++) {
            try { admitHost(i); } catch { /* refusals past the cap are expected */ }
        }
        expect(rateLimitMapSizes().hosts).toBe(CAP);

        // The victim's counter survived the flood: one more admits, the next does not.
        checkRateLimits(victim, "victim-client");
        expect(() => checkRateLimits(victim, "victim-client"))
            .toThrow(/Rate limit exceeded for host/);
    });

    it("frees capacity once the window has passed", () => {
        fillHostMapToCap();
        vi.advanceTimersByTime(RATE_LIMIT.WINDOW_MS + 1_000);
        expect(() => checkRateLimits("fresh.example.test", "fresh-client")).not.toThrow();
    });
});

describe("checkRateLimits — a backward wall-clock step", () => {
    // An NTP correction, a VM resume or a snapshot restore moves `Date.now()`
    // backwards. Windows are measured on a monotonic clock, so it is a
    // non-event — and both directions are asserted because the two failures a
    // wall clock produces here are mirrors of each other: entries stamped in
    // the future never expire and wedge the cap, while reading that same
    // negative age as expiry hands a saturated caller a fresh quota. A fix for
    // either one alone is the other one shipped.

    it("does not reset a quota that is already spent", () => {
        const host = "saturated.example.test";
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits(host, `client-${i}`);
        }
        vi.setSystemTime(Date.now() - 30 * 60_000);

        expect(() => checkRateLimits(host, "client-after-backstep"))
            .toThrow(/Rate limit exceeded for host/);
    });

    it("does not wedge tracking capacity", () => {
        fillHostMapToCap();
        vi.setSystemTime(Date.now() - 30 * 60_000);

        // Still at capacity, because no window has actually elapsed.
        expect(() => checkRateLimits("during-backstep.example.test", "fresh-client"))
            .toThrow(/tracking is at capacity/);

        // And the step did not cost the map its ability to expire: one window
        // of real elapsed time later, capacity is free again.
        vi.advanceTimersByTime(RATE_LIMIT.WINDOW_MS + 1_000);
        expect(() => checkRateLimits("after-backstep.example.test", "fresh-client"))
            .not.toThrow();
    });
});

describe("checkRateLimits — check order", () => {
    it("adds no host key for a request the client limit already refuses", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "noisy-client");
        }
        const before = rateLimitMapSizes().hosts;

        expect(() => checkRateLimits("never-tracked.example.test", "noisy-client"))
            .toThrow(/Client rate limit exceeded/);

        expect(rateLimitMapSizes().hosts).toBe(before);
    });
});

describe("checkRateLimits — default error text", () => {
    it("is byte-identical to the fixed-window message", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits("target.example.test", `client-${i}`);
        }
        expect(() => checkRateLimits("target.example.test", "client-final")).toThrow(
            new Error('Rate limit exceeded for host "target.example.test". Maximum 60 requests per minute.')
        );
    });
});

describe("checkRateLimits — configured sliding window", () => {
    const HOUR = 3_600_000;
    const HOST = "api.example.test";

    let handle: HostRateLimitHandle;

    beforeEach(() => {
        handle = installHostRateLimit({ max: 2, windowMs: HOUR });
    });

    function reinstall(limit: { max: number; windowMs: number }): void {
        releaseHostRateLimit(handle);
        handle = installHostRateLimit(limit);
    }

    it("admits max back to back and refuses the next", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        expect(() => checkRateLimits(HOST, "c3")).toThrow(/Rate limit exceeded for host/);
    });

    it("keeps its state across a cleanup sweep", () => {
        const interval = startRateLimitCleanup();
        try {
            checkRateLimits(HOST, "c1");
            checkRateLimits(HOST, "c2");
            // Six sweeps, and past the fixed window's 60 s: neither may reset a log.
            vi.advanceTimersByTime(61_000);
            expect(rateLimitMapSizes().slidingHosts).toBe(1);
            expect(() => checkRateLimits(HOST, "c3")).toThrow(/Rate limit exceeded for host/);
        } finally {
            stopRateLimitCleanup(interval);
        }
    });

    it("slides: admits one more as the oldest request leaves, not a fresh quota", () => {
        checkRateLimits(HOST, "c1");
        vi.advanceTimersByTime(HOUR / 2);
        checkRateLimits(HOST, "c2");

        vi.advanceTimersByTime(HOUR / 2 + 1);
        // The first request has left the window; the second has not.
        expect(() => checkRateLimits(HOST, "c3")).not.toThrow();
        expect(() => checkRateLimits(HOST, "c4")).toThrow(/Rate limit exceeded for host/);
    });

    it("names max, the window, and the time until the oldest request leaves", () => {
        checkRateLimits(HOST, "c1");
        vi.advanceTimersByTime(600_000);
        checkRateLimits(HOST, "c2");
        expect(() => checkRateLimits(HOST, "c3")).toThrow(
            new Error(
                `Rate limit exceeded for host "${HOST}". Maximum 2 requests per 3600 s; ` +
                "the oldest leaves the window in 3000 s."
            )
        );
    });

    it("counts each host separately and leaves the fixed host map untouched", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        expect(() => checkRateLimits("other.example.test", "c3")).not.toThrow();
        expect(rateLimitMapSizes()).toMatchObject({ hosts: 0, slidingHosts: 2 });
    });

    it("still enforces the per-client gate", () => {
        reinstall({ max: 10_000, windowMs: HOUR });
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "one-client");
        }
        expect(() => checkRateLimits("another.example.test", "one-client"))
            .toThrow(/Client rate limit exceeded/);
    });

    it("refuses an untracked host at the tracking cap, and the sweep frees it once the window passes", () => {
        reinstall({ max: 1, windowMs: 120_000 });
        fillHostSlidingLogToCap();
        expect(() => checkRateLimits("one-too-many.example.test", "fresh-client"))
            .toThrow(/tracking is at capacity .* Refusing an untracked host/);

        // Past the fixed 60 s window but inside the configured one: still full.
        vi.advanceTimersByTime(61_000);
        expect(() => checkRateLimits("still-full.example.test", "fresh-client-2"))
            .toThrow(/tracking is at capacity/);

        vi.advanceTimersByTime(60_000);
        expect(() => checkRateLimits("fresh.example.test", "fresh-client-3")).not.toThrow();
    });

    it("check and sweep agree at exactly windowMs", () => {
        reinstall({ max: 1, windowMs: 120_000 });
        const interval = startRateLimitCleanup();
        try {
            checkRateLimits(HOST, "c1");
            vi.advanceTimersByTime(119_999);
            expect(rateLimitMapSizes().slidingHosts).toBe(1);
            expect(() => checkRateLimits(HOST, "c2")).toThrow(/Rate limit exceeded for host/);

            // The sweep at 120 000 ms deletes the log, and the check would admit too.
            vi.advanceTimersByTime(1);
            expect(rateLimitMapSizes().slidingHosts).toBe(0);
            expect(() => checkRateLimits(HOST, "c3")).not.toThrow();
        } finally {
            stopRateLimitCleanup(interval);
        }
    });

    it("counts a trailing-dot spelling of a host against the same budget", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(`${HOST}.`, "c2");
        expect(() => checkRateLimits(`${HOST}..`, "c3")).toThrow(/Rate limit exceeded for host/);
        expect(rateLimitMapSizes().slidingHosts).toBe(1);
    });

    it("keeps the log across a release and a re-install with the same window", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        reinstall({ max: 2, windowMs: HOUR });
        expect(() => checkRateLimits(HOST, "c3")).toThrow(/Rate limit exceeded for host/);
    });

    it("drops the log on a re-install with a different window", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        reinstall({ max: 2, windowMs: 2 * HOUR });
        expect(rateLimitMapSizes().slidingHosts).toBe(0);
        expect(() => checkRateLimits(HOST, "c3")).not.toThrow();
    });

    it("sweeps a released log once its window passes", () => {
        reinstall({ max: 1, windowMs: 120_000 });
        const interval = startRateLimitCleanup();
        try {
            checkRateLimits(HOST, "c1");
            releaseHostRateLimit(handle);
            vi.advanceTimersByTime(110_000);
            expect(rateLimitMapSizes().slidingHosts).toBe(1);
            vi.advanceTimersByTime(10_000);
            expect(rateLimitMapSizes().slidingHosts).toBe(0);
        } finally {
            stopRateLimitCleanup(interval);
        }
    });

    it("restores the fixed default when released", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        releaseHostRateLimit(handle);
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits(HOST, `client-${i}`);
        }
        expect(() => checkRateLimits(HOST, "client-final"))
            .toThrow(/Maximum 60 requests per minute\.$/);
    });

    it("copies the limit, so mutating the caller's object changes nothing", () => {
        const limit = { max: 1, windowMs: HOUR };
        reinstall(limit);
        limit.max = 100;
        checkRateLimits(HOST, "c1");
        expect(() => checkRateLimits(HOST, "c2")).toThrow(/Maximum 1 requests/);
    });
});

describe("checkRateLimits — host key", () => {
    it("counts a trailing-dot spelling against the fixed per-host budget", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits(i % 2 ? "api.example.test." : "api.example.test", `c-${i}`);
        }
        expect(() => checkRateLimits("api.example.test.", "c-final"))
            .toThrow('Rate limit exceeded for host "api.example.test.". Maximum 60 requests per minute.');
        expect(rateLimitMapSizes().hosts).toBe(1);
    });
});

describe("installHostRateLimit — ownership", () => {
    const HOUR = 3_600_000;
    const HOST = "api.example.test";

    /** Spend the one request a `max: 1` limit admits, then prove it still holds. */
    function expectLimitOfOneHeld(): void {
        expect(() => checkRateLimits(HOST, "probe")).toThrow(/Maximum 1 requests per 3600 s/);
    }

    it.each([
        [{ max: NaN, windowMs: 1 }, "rateLimit.max must be a positive integer, got: NaN"],
        [{ max: 1, windowMs: 0 }, "rateLimit.windowMs must be a positive integer, got: 0"],
        [null, "rateLimit must be an object { max, windowMs }, got: null"],
    ])("refuses %o and installs nothing", (limit, message) => {
        expect(() => installHostRateLimit(limit as never)).toThrow(new Error(message));
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) checkRateLimits(HOST, `c-${i}`);
        expect(() => checkRateLimits(HOST, "c-final")).toThrow(/Maximum 60 requests per minute\.$/);
    });

    it("refuses a second install while the first is held, and keeps the first", () => {
        installHostRateLimit({ max: 1, windowMs: HOUR });
        checkRateLimits(HOST, "c1");
        expect(() => installHostRateLimit({ max: 100, windowMs: HOUR }))
            .toThrow(/already installed by another McpCurlServer/);
        expectLimitOfOneHeld();
    });

    it("ignores a release by a handle that does not hold the limit", () => {
        const first = installHostRateLimit({ max: 5, windowMs: HOUR });
        releaseHostRateLimit(first);
        releaseHostRateLimit(first);
        installHostRateLimit({ max: 1, windowMs: HOUR });
        checkRateLimits(HOST, "c1");

        releaseHostRateLimit(first);
        releaseHostRateLimit(Symbol("stranger"));
        expectLimitOfOneHeld();
    });
});

/** Fill the sliding host log to exactly CAP with distinct hosts. */
function fillHostSlidingLogToCap(): void {
    for (let i = 0; i < CAP; i++) admitHost(i);
    expect(rateLimitMapSizes().slidingHosts).toBe(CAP);
}
