// src/lib/security/rate-limiter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimits, clearRateLimitMaps, rateLimitMapSizes } from "./rate-limiter.js";
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
        vi.setSystemTime(Date.now() + RATE_LIMIT.WINDOW_MS + 1_000);
        expect(() => checkRateLimits("fresh.example.test", "fresh-client")).not.toThrow();
    });

    it("frees capacity when the wall clock jumps BACKWARDS", () => {
        // An NTP correction, a VM resume or a snapshot restore leaves every
        // entry stamped in the future. Treated naively those never expire, and
        // since expiry is the only route to freeing capacity the map wedges and
        // refuses every new key until the clock catches up.
        fillHostMapToCap();
        vi.setSystemTime(Date.now() - 30 * 60_000);
        expect(() => checkRateLimits("after-backstep.example.test", "fresh-client")).not.toThrow();
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
