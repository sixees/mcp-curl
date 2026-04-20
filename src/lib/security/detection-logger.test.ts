// src/lib/security/detection-logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    logInjectionDetected,
    cleanupInjectionDetectionMap,
    clearInjectionDetectionMap,
} from "./detection-logger.js";

beforeEach(() => {
    clearInjectionDetectionMap();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    clearInjectionDetectionMap();
});

describe("logInjectionDetected", () => {
    it("logs on first detection for a hostname", () => {
        logInjectionDetected("api.example.com");
        expect(console.error).toHaveBeenCalledWith(
            "[injection-defense] [api.example.com] InjectionDetected"
        );
    });

    it("throttles subsequent detections within 60 seconds", () => {
        logInjectionDetected("api.example.com");
        logInjectionDetected("api.example.com");
        logInjectionDetected("api.example.com");
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("logs independently for different hostnames", () => {
        logInjectionDetected("host-a.com");
        logInjectionDetected("host-b.com");
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it("does not include detection content in log message", () => {
        logInjectionDetected("evil.com");
        const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
        const logMessage = String(calls[0][0]);
        // Must NOT include any injection keywords or payload content
        expect(logMessage).not.toContain("ignore");
        expect(logMessage).not.toContain("instructions");
        expect(logMessage).not.toContain("exfiltrate");
    });

    it("logs again after throttle window passes", () => {
        const now = Date.now();
        vi.spyOn(Date, "now")
            .mockReturnValueOnce(now)                    // first log
            .mockReturnValueOnce(now + 30_000)           // within window — throttled
            .mockReturnValueOnce(now + 61_000);          // past window — logs again

        logInjectionDetected("host.com"); // logged
        logInjectionDetected("host.com"); // throttled (30s < 60s)
        logInjectionDetected("host.com"); // logged (61s > 60s)

        expect(console.error).toHaveBeenCalledTimes(2);
    });
});

describe("cleanupInjectionDetectionMap", () => {
    it("removes expired entries", () => {
        const now = Date.now();
        // Log a detection so it's in the map
        vi.spyOn(Date, "now").mockReturnValue(now);
        logInjectionDetected("old.com");

        // Advance time past throttle window, then cleanup
        vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
        cleanupInjectionDetectionMap();

        // After cleanup, should log again (entry removed)
        (console.error as ReturnType<typeof vi.spyOn>).mockClear();
        logInjectionDetected("old.com");
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("keeps entries within throttle window", () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        logInjectionDetected("recent.com");

        // Advance time but within window, then cleanup
        vi.spyOn(Date, "now").mockReturnValue(now + 30_000);
        cleanupInjectionDetectionMap();

        // Within window — still throttled
        (console.error as ReturnType<typeof vi.spyOn>).mockClear();
        logInjectionDetected("recent.com");
        expect(console.error).not.toHaveBeenCalled();
    });
});

describe("clearInjectionDetectionMap", () => {
    it("removes all entries, allowing immediate re-detection", () => {
        logInjectionDetected("host.com");
        clearInjectionDetectionMap();
        (console.error as ReturnType<typeof vi.spyOn>).mockClear();

        logInjectionDetected("host.com");
        expect(console.error).toHaveBeenCalledTimes(1);
    });
});
