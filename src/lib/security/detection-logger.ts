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
 * sanitiser removes U+2028, U+2029 and U+FEFF, which `\s` matches, so a phrase
 * spaced with them (`system\u2028prompt`) matches only in the original; it
 * also removes zero-width and bidi characters, so a phrase they split
 * (`Ig\u200bnore previous instructions`) matches only in the sanitised form.
 * Both forms are taken before any strip stage runs, so either one keeps the
 * signal for a phrase a later stage would erase. Testing both rewrites
 * nothing — this is the detection a caller returning the origin's payload
 * still owes (`LESSONS.md` RC-49): the per-host log is an operator signal
 * ARCHITECTURE.md invariant 7 forbids suppressing.
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
 * {@link detectAndLog} plus a decoded read, for text that may be a JSON
 * document returned unchanged: `defendForInline` calls it on its JSON arm, and
 * `processResponse` calls it on every body above its JSON/non-JSON fork.
 *
 * **A document can spell a phrase with string escapes** — `Ig\u200bnore`,
 * `\u0049gnore`, `system\nprompt` — which neither text form shows and the
 * model decodes on reading. So each string token carrying an escape is
 * decoded on its own, and its decoded value tested in both forms, then
 * discarded: this rewrites nothing (`LESSONS.md` RC-49).
 *
 * **Token by token, never by re-serialising the parsed document.** A parse
 * keeps only the last of two duplicate members, so a re-serialised
 * `{"x":"\u0049gnore …","x":"ok"}` holds `ok` alone, and `JSON.stringify`
 * re-escapes a decoded control character, so `system\u000aprompt` comes back
 * with a backslash and an `n` where `\s` needed a newline — the
 * parse-and-reserialise loss `LESSONS.md` RC-24 records.
 * Decoding each token alone also keeps a match from spanning two values.
 * Text with no backslash has nothing to decode and costs one `includes`.
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
    if (!text.includes("\\")) return false;
    for (const token of escapedStringTokens(text)) {
        let decoded: unknown;
        try {
            decoded = JSON.parse(token);
        } catch {
            continue;
        }
        if (typeof decoded === "string" && matchesEitherForm(decoded)) return true;
    }
    return false;
}

/**
 * Each `"…"` token in `text` that carries a backslash, found the way a JSON
 * lexer finds them: a quote opens a token outside one, a backslash skips the
 * character after it, and the next unescaped quote closes it.
 *
 * A single linear pass rather than a regex, because `/"(?:[^"\\]|\\.)*"/g`
 * re-scans from every quote when the closing one never comes — quadratic on a
 * body of escaped quotes, at sizes up to the 10 MB response cap. On text that
 * is not JSON the tokens are whatever the quotes delimit, and a token that does
 * not parse is skipped.
 */
function* escapedStringTokens(text: string): Generator<string> {
    let start = -1;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (start < 0) {
            if (c === 0x22) {
                start = i;
                escaped = false;
            }
        } else if (c === 0x5c) {
            escaped = true;
            i++;
        } else if (c === 0x22) {
            if (escaped) yield text.slice(start, i + 1);
            start = -1;
        }
    }
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
 * Run by `startInjectionCleanup`'s interval where a caller started one, and by
 * `setBounded` before it evicts a live entry at the cap — the cap, not the
 * interval, is the bound, because the `mcp-curl` root entry exports no
 * cleanup starter.
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
