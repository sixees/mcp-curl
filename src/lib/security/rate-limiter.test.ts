// src/lib/security/rate-limiter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimits, clearRateLimitMaps, rateLimitMapSizes } from "./rate-limiter.js";
import { RATE_LIMIT, THROTTLE } from "../config/session.js";

const CAP = THROTTLE.MAX_TRACKED_KEYS;

beforeEach(() => {
    clearRateLimitMaps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
    clearRateLimitMaps();
});

/** One admitted request per call: a fresh host AND a fresh client each time. */
function admitDistinct(i: number): void {
    checkRateLimits(`host-${i}.example.test`, `client-${i}`);
}

describe("checkRateLimits — limits", () => {
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

describe("checkRateLimits — tracking capacity (bounded without the cleanup interval)", () => {
    // No interval is started here, which is the embedder's situation:
    // `registerEndpointTools` and `executeCurlRequest` are exported, and neither
    // starts `startRateLimitCleanup`. Before the cap these maps grew one entry
    // per distinct hostname for the life of the process.

    it("never tracks more keys than the cap, however many distinct pairs arrive", () => {
        let rejected = 0;
        for (let i = 0; i < CAP + 500; i++) {
            try {
                admitDistinct(i);
            } catch {
                rejected++;
            }
        }
        const { hosts, clients } = rateLimitMapSizes();
        expect(hosts).toBeLessThanOrEqual(CAP);
        expect(clients).toBeLessThanOrEqual(CAP);
        expect(rejected).toBeGreaterThan(0);
    });

    it("REFUSES an untracked key rather than evicting a tracked one", () => {
        // This is the assertion that fails if someone reaches for the evicting
        // helper in `bounded-throttle.ts`. Evicting would reset a counter, which
        // hands the evicted host a fresh budget mid-window — a bypass of the
        // limit, dressed as a memory fix.
        const victim = "victim.example.test";

        // Put the victim most of the way to its ceiling.
        const nearLimit = RATE_LIMIT.MAX_PER_HOST_PER_MINUTE - 1;
        for (let i = 0; i < nearLimit; i++) {
            checkRateLimits(victim, `victim-client-${i}`);
        }

        // Now flood past the tracking cap with other hosts. If any of this
        // evicted the victim, its counter would restart at 1.
        for (let i = 0; i < CAP + 200; i++) {
            try {
                admitDistinct(i);
            } catch {
                /* refusals are the point */
            }
        }

        // The victim's counter survived: one more admits, the next is refused.
        // Probe with a client that is ALREADY tracked — at capacity a new
        // client id is refused at the client gate, which is the intended
        // fail-closed behaviour and would mask what this case is measuring.
        checkRateLimits(victim, "victim-client-0");
        expect(() => checkRateLimits(victim, "victim-client-0"))
            .toThrow(/Rate limit exceeded for host/);
    });

    it("frees capacity again once the window has passed", () => {
        for (let i = 0; i < CAP; i++) {
            try { admitDistinct(i); } catch { /* fill to the cap */ }
        }
        vi.setSystemTime(Date.now() + RATE_LIMIT.WINDOW_MS + 1_000);
        // Every tracked entry is now expired, so the inline sweep makes room.
        expect(() => checkRateLimits("fresh.example.test", "fresh-client")).not.toThrow();
    });
});

describe("checkRateLimits — check order", () => {
    it("adds no host key for a request the client limit already refuses", () => {
        for (let i = 0; i < RATE_LIMIT.MAX_PER_CLIENT_PER_MINUTE; i++) {
            checkRateLimits(`host-${i}.example.test`, "noisy-client");
        }
        const before = rateLimitMapSizes().hosts;

        // Over quota. The host write must not happen: it used to, because the
        // host limiter ran first and `checkRateLimitInternal` writes before it
        // can throw — putting the growth upstream of the thing that bounds it.
        expect(() => checkRateLimits("never-tracked.example.test", "noisy-client"))
            .toThrow(/Client rate limit exceeded/);

        expect(rateLimitMapSizes().hosts).toBe(before);
    });
});
