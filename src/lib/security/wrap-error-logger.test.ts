// src/lib/security/wrap-error-logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    logWrapError,
    cleanupWrapErrorMap,
    clearWrapErrorMap,
    wrapErrorMapSize,
} from "./wrap-error-logger.js";
import { THROTTLE } from "../config/session.js";

beforeEach(() => {
    clearWrapErrorMap();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    clearWrapErrorMap();
});

describe("logWrapError", () => {
    it("logs ErrorClassName + hostname on first call", () => {
        logWrapError("api.example.com", new TypeError("boom"));
        expect(console.error).toHaveBeenCalledWith(
            "[wrap-error] [api.example.com] TypeError"
        );
    });

    it("does not include the error message in the log line", () => {
        logWrapError("api.example.com", new Error("secret value: ABCDEF"));
        const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
        const message = String(calls[0][0]);
        expect(message).not.toContain("secret");
        expect(message).not.toContain("ABCDEF");
        expect(message).toBe("[wrap-error] [api.example.com] Error");
    });

    it("throttles repeated errors on the same hostname", () => {
        logWrapError("host.com", new Error("e1"));
        logWrapError("host.com", new Error("e2"));
        logWrapError("host.com", new Error("e3"));
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("logs independently for different hostnames", () => {
        logWrapError("a.com", new Error());
        logWrapError("b.com", new Error());
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it("logs again after the throttle window passes", () => {
        const now = Date.now();
        vi.spyOn(Date, "now")
            .mockReturnValueOnce(now)
            .mockReturnValueOnce(now + 30_000)
            .mockReturnValueOnce(now + 61_000);

        logWrapError("host.com", new Error());
        logWrapError("host.com", new Error()); // throttled
        logWrapError("host.com", new Error()); // re-fires past window

        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it("falls back to UnknownError when a non-Error is thrown", () => {
        logWrapError("host.com", "just a string");
        expect(console.error).toHaveBeenCalledWith(
            "[wrap-error] [host.com] UnknownError"
        );
    });

    it("falls back to UnknownError on Error subclass with empty name", () => {
        const err = new Error("e");
        // Force pathological case: explicit empty name
        Object.defineProperty(err, "name", { value: "", configurable: true });
        logWrapError("host.com", err);
        expect(console.error).toHaveBeenCalledWith(
            "[wrap-error] [host.com] UnknownError"
        );
    });

    it("strips control chars from the hostname label", () => {
        logWrapError("evil.com\nfake log line", new Error());
        const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
        const message = String(calls[0][0]);
        expect(message).not.toContain("\n");
        expect(message).toContain("evil.comfake log line");
    });

    it("truncates long hostnames to 128 chars", () => {
        const longHost = "a".repeat(200) + ".com";
        logWrapError(longHost, new Error());
        const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
        const match = String(calls[0][0]).match(
            /^\[wrap-error\] \[([^\]]+)\] \w+$/
        );
        expect(match).not.toBeNull();
        expect(match![1].length).toBeLessThanOrEqual(128);
    });
});

describe("cleanupWrapErrorMap", () => {
    it("evicts expired entries so subsequent errors log again", () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        logWrapError("host.com", new Error());

        vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
        cleanupWrapErrorMap();

        (console.error as ReturnType<typeof vi.spyOn>).mockClear();
        logWrapError("host.com", new Error());
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("preserves entries still inside the throttle window", () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        logWrapError("host.com", new Error());

        vi.spyOn(Date, "now").mockReturnValue(now + 30_000);
        cleanupWrapErrorMap();

        (console.error as ReturnType<typeof vi.spyOn>).mockClear();
        logWrapError("host.com", new Error());
        expect(console.error).not.toHaveBeenCalled();
    });
});

describe("label-map bound (invariant: the map is finite without the interval)", () => {
    // The cleanup interval is started only by `McpCurlServer`. On both shipped
    // transports, and on every library path that reaches `logWrapError` through
    // the exported `registerEndpointTools`, the cap below is the ONLY bound.
    it("stays at or under the cap across more distinct labels than it tracks", () => {
        for (let i = 0; i < THROTTLE.MAX_TRACKED_KEYS + 200; i++) {
            logWrapError(`host-${i}.example.com`, new Error("boom"));
        }
        expect(wrapErrorMapSize()).toBe(THROTTLE.MAX_TRACKED_KEYS);
    });
});
