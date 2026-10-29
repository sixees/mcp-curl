// src/lib/security/rate-limiter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    applyServerRemaining,
    checkRateLimits,
    clearRateLimitMaps,
    hostRateLimitSyncHeader,
    installHostRateLimit,
    parseHostRateLimit,
    rateLimitMapSizes,
    releaseHostRateLimit,
    slidingLogSize,
    type HostRateLimitHandle,
    startRateLimitCleanup,
    stopRateLimitCleanup,
} from "./rate-limiter.js";
import { RATE_LIMIT } from "../config/session.js";
import { LocalRefusalError } from "../utils/index.js";

const CAP = RATE_LIMIT.MAX_TRACKED_KEYS;

// Fewer requests per client than its quota, so the client gate never fires
// while a case is filling the HOST map. Rotating the client id on every call
// fills the client map in lockstep with the host map, so the next fresh client
// is refused by the CLIENT cap — and an assertion matching only "tracking is
// at capacity" passes on that refusal without the host branch ever running.
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
            .toThrow(/LOCAL_RATE_LIMITED/);
    });

    it("throws once a client passes its per-minute ceiling", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "one-client");
        }
        expect(() => checkRateLimits("another.example.test", "one-client"))
            .toThrow(/LOCAL_RATE_LIMITED/);
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
            .toThrow(/LOCAL_RATE_LIMITED/);
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
            .toThrow(/LOCAL_RATE_LIMITED/);
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
            .toThrow(/LOCAL_RATE_LIMITED/);

        expect(rateLimitMapSizes().hosts).toBe(before);
    });
});

describe("checkRateLimits — refusal text", () => {
    it("is a LOCAL_RATE_LIMITED refusal naming the wait and no host", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits("target.example.test", `client-${i}`);
        }
        vi.advanceTimersByTime(15_500);
        expect(() => checkRateLimits("target.example.test", "client-final")).toThrow(
            "Refused locally: no request was sent (LOCAL_RATE_LIMITED). The rate limit for this target or session is exhausted; wait before retrying. Retry in 45 s."
        );
    });

    it("carries the code and the wait on the error", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "one-client");
        }
        let refusal: unknown;
        try {
            checkRateLimits("another.example.test", "one-client");
        } catch (error) {
            refusal = error;
        }
        expect(refusal).toBeInstanceOf(LocalRefusalError);
        expect(refusal).toMatchObject({ code: "LOCAL_RATE_LIMITED", reason: "rate-limited", retryAfterSeconds: 60 });
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
        expect(() => checkRateLimits(HOST, "c3")).toThrow(/LOCAL_RATE_LIMITED/);
    });

    it("keeps its state across a cleanup sweep", () => {
        const interval = startRateLimitCleanup();
        try {
            checkRateLimits(HOST, "c1");
            checkRateLimits(HOST, "c2");
            // Six sweeps, and past the fixed window's 60 s: neither may reset a log.
            vi.advanceTimersByTime(61_000);
            expect(rateLimitMapSizes().slidingHosts).toBe(1);
            expect(() => checkRateLimits(HOST, "c3")).toThrow(/LOCAL_RATE_LIMITED/);
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
        expect(() => checkRateLimits(HOST, "c4")).toThrow(/LOCAL_RATE_LIMITED/);
    });

    it("names the time until the oldest request leaves, and no host", () => {
        checkRateLimits(HOST, "c1");
        vi.advanceTimersByTime(600_000);
        checkRateLimits(HOST, "c2");
        expect(() => checkRateLimits(HOST, "c3")).toThrow("Refused locally: no request was sent (LOCAL_RATE_LIMITED). The rate limit for this target or session is exhausted; wait before retrying. Retry in 3000 s.");
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
            .toThrow(/LOCAL_RATE_LIMITED/);
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
            expect(() => checkRateLimits(HOST, "c2")).toThrow(/LOCAL_RATE_LIMITED/);

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
        expect(() => checkRateLimits(`${HOST}..`, "c3")).toThrow(/LOCAL_RATE_LIMITED/);
        expect(rateLimitMapSizes().slidingHosts).toBe(1);
    });

    it("keeps the log across a release and a re-install with the same window", () => {
        checkRateLimits(HOST, "c1");
        checkRateLimits(HOST, "c2");
        reinstall({ max: 2, windowMs: HOUR });
        expect(() => checkRateLimits(HOST, "c3")).toThrow(/LOCAL_RATE_LIMITED/);
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
            .toThrow(/Retry in 60 s\.$/);
    });

    it("copies the limit, so mutating the caller's object changes nothing", () => {
        const limit = { max: 1, windowMs: HOUR };
        reinstall(limit);
        limit.max = 100;
        checkRateLimits(HOST, "c1");
        expect(() => checkRateLimits(HOST, "c2")).toThrow(/LOCAL_RATE_LIMITED/);
    });
});

describe("checkRateLimits — host key", () => {
    it("counts a trailing-dot spelling against the fixed per-host budget", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) {
            checkRateLimits(i % 2 ? "api.example.test." : "api.example.test", `c-${i}`);
        }
        expect(() => checkRateLimits("api.example.test.", "c-final"))
            .toThrow(/LOCAL_RATE_LIMITED.*Retry in 60 s\.$/);
        expect(rateLimitMapSizes().hosts).toBe(1);
    });
});

describe("installHostRateLimit — ownership", () => {
    const HOUR = 3_600_000;
    const HOST = "api.example.test";

    /** Prove a `max: 1` limit still holds: the caller has spent its one request, so the next is refused. */
    function expectLimitOfOneHeld(): void {
        expect(() => checkRateLimits(HOST, "probe")).toThrow(/Retry in 3600 s\./);
    }

    it.each([
        [{ max: NaN, windowMs: 1 }, "rateLimit.max must be a positive integer, got: NaN"],
        [{ max: 1, windowMs: 0 }, "rateLimit.windowMs must be a positive integer, got: 0"],
        [null, "rateLimit must be an object { max, windowMs }, got: null"],
    ])("refuses %o and installs nothing", (limit, message) => {
        expect(() => installHostRateLimit(limit as never)).toThrow(new Error(message));
        for (let i = 0; i < RATE_LIMIT.MAX_PER_HOST_PER_MINUTE; i++) checkRateLimits(HOST, `c-${i}`);
        expect(() => checkRateLimits(HOST, "c-final")).toThrow(/Retry in 60 s\.$/);
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

describe("parseHostRateLimit — syncFromHeaders", () => {
    const BASE = { max: 5, windowMs: 60_000 };

    it("returns a frozen copy of the header name", () => {
        const sync = { remaining: "X-RateLimit-Remaining" };
        const parsed = parseHostRateLimit({ ...BASE, syncFromHeaders: sync });
        sync.remaining = "Changed";
        expect(parsed.syncFromHeaders).toEqual({ remaining: "X-RateLimit-Remaining" });
        expect(Object.isFrozen(parsed.syncFromHeaders)).toBe(true);
    });

    it("leaves the field out when it is not set", () => {
        expect(parseHostRateLimit(BASE)).not.toHaveProperty("syncFromHeaders");
    });

    it.each([
        ["a reset key", { remaining: "X-Remaining", reset: "X-Reset" }, /accepts only "remaining", got: reset/],
        ["no remaining", {}, /remaining must be an HTTP header name/],
        ["an empty name", { remaining: "" }, /remaining must be an HTTP header name/],
        ["a space", { remaining: "X Remaining" }, /remaining must be an HTTP header name/],
        ["a %", { remaining: "X-%{url}" }, /remaining must be an HTTP header name/],
        ["a brace", { remaining: "X}" }, /remaining must be an HTTP header name/],
        ["a non-string", { remaining: 5 }, /remaining must be an HTTP header name/],
        ["an array", ["X-Remaining"], /must be an object \{ remaining \}/],
        ["a string", "X-Remaining", /must be an object \{ remaining \}/],
        ["null", null, /must be an object \{ remaining \}/],
    ])("throws on %s", (_label, syncFromHeaders, message) => {
        expect(() => parseHostRateLimit({ ...BASE, syncFromHeaders })).toThrow(message);
    });
});

describe("applyServerRemaining", () => {
    const HOST = "api.example.test";
    const WINDOW = 60_000;
    let handle: HostRateLimitHandle;

    beforeEach(() => {
        handle = installHostRateLimit({ max: 5, windowMs: WINDOW, syncFromHeaders: { remaining: "X-Remaining" } });
    });

    /** Requests the gate still admits for HOST — a positive control that saturates it (RC-19). */
    function admittedBeforeRefusal(): number {
        let admitted = 0;
        for (let i = 0; i < 10; i++) {
            try {
                checkRateLimits(HOST, `c-${i}`);
                admitted++;
            } catch {
                return admitted;
            }
        }
        throw new Error("the gate never refused");
    }

    it("exposes the configured header name while the limit is installed", () => {
        expect(hostRateLimitSyncHeader()).toBe("X-Remaining");
        releaseHostRateLimit(handle);
        expect(hostRateLimitSyncHeader()).toBeUndefined();
    });

    it("tightens to the upstream's figure", () => {
        checkRateLimits(HOST, "first");
        applyServerRemaining(HOST, 2);
        expect(admittedBeforeRefusal()).toBe(2);
    });

    it("leaves the log alone for a figure above the local remaining", () => {
        checkRateLimits(HOST, "first");
        applyServerRemaining(HOST, 10);
        expect(slidingLogSize(HOST).counted).toBe(1);
        expect(admittedBeforeRefusal()).toBe(4);
    });

    it("never removes entries", () => {
        for (let i = 0; i < 4; i++) checkRateLimits(HOST, `early-${i}`);
        applyServerRemaining(HOST, 5);
        expect(slidingLogSize(HOST).counted).toBe(4);
    });

    it("fills the window on 0, and never writes past max", () => {
        checkRateLimits(HOST, "first");
        applyServerRemaining(HOST, 0);
        applyServerRemaining(HOST, 0);
        expect(slidingLogSize(HOST).counted).toBe(5);
        expect(admittedBeforeRefusal()).toBe(0);
    });

    it("stores one run per pad, whatever max is", () => {
        releaseHostRateLimit(handle);
        installHostRateLimit({ max: 10_000_000, windowMs: WINDOW, syncFromHeaders: { remaining: "X-Remaining" } });
        applyServerRemaining(HOST, 0);
        applyServerRemaining("other.example.test", 0);
        expect(slidingLogSize(HOST)).toEqual({ counted: 10_000_000, stored: 1 });
        expect(slidingLogSize("other.example.test")).toEqual({ counted: 10_000_000, stored: 1 });
        expect(() => checkRateLimits(HOST, "after-pad")).toThrow(/LOCAL_RATE_LIMITED/);
    });

    it("frees only the pad's share when an earlier admission expires", () => {
        checkRateLimits(HOST, "first");
        vi.advanceTimersByTime(WINDOW / 2);
        applyServerRemaining(HOST, 0);
        expect(slidingLogSize(HOST)).toEqual({ counted: 5, stored: 2 });
        vi.advanceTimersByTime(WINDOW / 2);
        expect(admittedBeforeRefusal()).toBe(1);
    });

    it("expires its pads at windowMs", () => {
        applyServerRemaining(HOST, 0);
        vi.advanceTimersByTime(WINDOW - 1);
        expect(admittedBeforeRefusal()).toBe(0);
        vi.advanceTimersByTime(1);
        expect(admittedBeforeRefusal()).toBe(5);
    });

    it("expires its pads by elapsed time across a backward wall-clock step", () => {
        applyServerRemaining(HOST, 0);
        vi.setSystemTime(Date.now() - 30 * 60_000);
        expect(admittedBeforeRefusal()).toBe(0);
        vi.advanceTimersByTime(WINDOW);
        expect(admittedBeforeRefusal()).toBe(5);
    });

    it("counts a trailing-dot spelling as the same host", () => {
        applyServerRemaining(`${HOST}.`, 0);
        expect(admittedBeforeRefusal()).toBe(0);
    });

    it("writes nothing when no limit is installed", () => {
        releaseHostRateLimit(handle);
        applyServerRemaining(HOST, 0);
        expect(rateLimitMapSizes().slidingHosts).toBe(0);
    });

    it("keeps the local count, without throwing, for a host the map has no room for", () => {
        fillHostSlidingLogToCap();
        expect(() => applyServerRemaining("untracked.example.test", 0)).not.toThrow();
        expect(rateLimitMapSizes().slidingHosts).toBe(CAP);
    });
});

/** Fill the sliding host log to exactly CAP with distinct hosts. */
function fillHostSlidingLogToCap(): void {
    for (let i = 0; i < CAP; i++) admitHost(i);
    expect(rateLimitMapSizes().slidingHosts).toBe(CAP);
}
