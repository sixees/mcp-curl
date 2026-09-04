// src/lib/security/detection-logger.ts
// Throttled logger for prompt injection pattern detection events

import { sanitizeResponse, detectInjectionPattern } from "../utils/index.js";
import { setBounded } from "./bounded-throttle.js";

const THROTTLE_WINDOW_MS = 60_000; // 1 detection log per hostname per 60 seconds; also used as cleanup interval

// Private map: hostname → timestamp of last logged detection.
// Bounded at the write by `setBounded`, which owns the reasoning: this module
// exports `sanitizeAndDetect` and `logInjectionDetected` on the `mcp-curl` root
// entry point, which exports no cleanup starter at all — so a consumer
// composing them by hand has no interval available and the cap is the only bound.
const lastDetectedMap = new Map<string, number>();

/**
 * Normalize a hostname or label for safe log output.
 * Strips C0/C1 control chars and limits length to prevent log injection.
 */
function normalizeDetectionLabel(label: string): string {
    // eslint-disable-next-line no-control-regex
    return label.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 128);
}

/**
 * Log a prompt injection detection event, throttled to once per hostname per minute.
 * Logs only the hostname and event class — never the matched phrase content,
 * which could itself contain injection payloads.
 *
 * @param hostname - Target hostname where the pattern was detected
 */
export function logInjectionDetected(hostname: string): void {
    const safeLabel = normalizeDetectionLabel(hostname);
    const now = Date.now();
    const lastSeen = lastDetectedMap.get(safeLabel);
    if (lastSeen !== undefined && now - lastSeen < THROTTLE_WINDOW_MS) {
        return; // throttled — already logged within the last minute
    }
    setBounded(lastDetectedMap, safeLabel, now, cleanupInjectionDetectionMap);
    console.error(`[injection-defense] [${safeLabel}] InjectionDetected`);
}

/**
 * Detect injection patterns in raw text, then sanitize for output.
 *
 * Order is load-bearing: detection runs against the **original** text, before
 * any sanitisation. This is forward-readiness for future stripping passes
 * (PR-7 plans to strip `<script>`/`<style>` blocks and external markdown
 * beacons) — if those passes erase a malicious phrase before detection sees
 * it, the per-host log signal is silenced. Detecting on the original keeps
 * the signal alive for any class of injection that the sanitiser would
 * otherwise wholesale-remove.
 *
 * **Acknowledged trade-off.** The reverse case (a phrase whose detection
 * needs sanitisation to *succeed* — e.g. invisible-char-split phrases like
 * `Ig​nore previous instructions` where the zero-width breaks the regex
 * match) is no longer logged. The returned text is still sanitised so
 * nothing leaks downstream; only the observability log is lost for that
 * specific class. UTS #39 skeleton folding (deferred) would close it.
 *
 * Detection-only: the sanitized text is returned regardless of whether
 * an injection pattern was matched. Logging is throttled per label by
 * `logInjectionDetected`.
 *
 * @param text - Raw response text (or filtered output) to sanitize
 * @param label - Hostname or filename used as the log label
 * @returns Sanitized text
 */
export function sanitizeAndDetect(text: string, label: string): string {
    if (detectInjectionPattern(text)) {
        logInjectionDetected(label);
    }
    return sanitizeResponse(text);
}

/**
 * Start the injection detection cleanup interval.
 * Evicts expired throttle entries on the same cadence as the throttle window.
 *
 * @returns The interval handle (pass to stopInjectionCleanup to clear)
 */
export function startInjectionCleanup(): NodeJS.Timeout {
    const interval = setInterval(cleanupInjectionDetectionMap, THROTTLE_WINDOW_MS);
    interval.unref();
    return interval;
}

/**
 * Stop the injection detection cleanup interval.
 */
export function stopInjectionCleanup(interval: NodeJS.Timeout): void {
    clearInterval(interval);
}

/**
 * Evict entries older than the throttle window.
 * Called on a periodic interval to prevent unbounded map growth.
 */
export function cleanupInjectionDetectionMap(): void {
    const now = Date.now();
    for (const [key, timestamp] of lastDetectedMap) {
        if (now - timestamp >= THROTTLE_WINDOW_MS) {
            lastDetectedMap.delete(key);
        }
    }
}

/**
 * Clear all detection map entries.
 *
 * **WARNING: For testing purposes only.** Do not call in production code.
 * Resets throttle state between test cases.
 *
 * @internal
 */
export function clearInjectionDetectionMap(): void {
    lastDetectedMap.clear();
}

/**
 * Test-only: current tracked-label count, so a test can assert the cap holds.
 *
 * @internal
 */
export function detectionMapSize(): number {
    return lastDetectedMap.size;
}
