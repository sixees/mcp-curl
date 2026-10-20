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
 * Detect injection patterns and log a hit, leaving the text alone.
 *
 * **Two representations, because each hides a class from the other.** The
 * original is what a later strip stage would erase a phrase from, so detecting
 * there keeps the signal for that class; the sanitised form is what a
 * zero-width or bidi split hides from, so `Ig\u200bnore previous instructions`
 * matches only there. Testing both rewrites nothing — this is the detection a
 * caller returning the origin's payload still owes (`LESSONS.md` RC-49): the
 * per-host log is an operator signal ARCHITECTURE.md invariant 7 forbids
 * suppressing.
 *
 * @param text - The original text
 * @param label - Hostname or filename used as the log label
 * @param sanitised - `sanitizeResponse(text)`, where the caller already holds
 *   it; computed here otherwise
 */
export function detectAndLog(text: string, label: string, sanitised?: string): void {
    if (matchesEitherForm(text, sanitised)) logInjectionDetected(label);
}

/**
 * {@link detectAndLog} for a JSON document returned unchanged — which is every
 * JSON arm, so both of them call this rather than the text form.
 *
 * **A document can spell a phrase with string escapes** — `Ig\u200bnore` or
 * `\u0049gnore`, six ASCII bytes per character — which neither text form
 * shows and the model decodes on reading. So where an escape is present the
 * decoded rendering is tested too, and discarded: this rewrites nothing
 * (`LESSONS.md` RC-49). `JSON.stringify` writes every non-control character
 * literally, which is what lets the sanitised read join a split phrase. The
 * parse runs only when the text carries a `\u` escape, and not at all on text
 * that is not JSON.
 *
 * @param text - The text as returned
 * @param label - Hostname or filename used as the log label
 * @param sanitised - `sanitizeResponse(text)`, where the caller already holds it
 */
export function detectJsonAndLog(text: string, label: string, sanitised?: string): void {
    if (matchesEitherForm(text, sanitised) || matchesDecodedForm(text)) logInjectionDetected(label);
}

function matchesEitherForm(text: string, sanitised?: string): boolean {
    return detectInjectionPattern(text) || detectInjectionPattern(sanitised ?? sanitizeResponse(text));
}

function matchesDecodedForm(text: string): boolean {
    if (!text.includes("\\u")) return false;
    let decoded: string;
    try {
        decoded = JSON.stringify(JSON.parse(text.trim()));
    } catch {
        return false;
    }
    return matchesEitherForm(decoded);
}

/**
 * Detect injection patterns, then sanitize for output.
 *
 * Detection runs against the **original** text as well as the sanitised form
 * — {@link detectAndLog} owns why both. `defendText`'s later stages strip markup
 * comments, `<script>`/`<style>` blocks and markdown beacons, and a stage that
 * erased a malicious phrase before detection saw it would silence the per-host
 * log signal; the sanitised form is what catches a phrase split by an
 * invisible character.
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
    const sanitised = sanitizeResponse(text);
    detectAndLog(text, label, sanitised);
    return sanitised;
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
