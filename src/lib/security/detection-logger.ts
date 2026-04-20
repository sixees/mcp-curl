// src/lib/security/detection-logger.ts
// Throttled logger for prompt injection pattern detection events

const THROTTLE_WINDOW_MS = 60_000; // 1 detection log per hostname per 60 seconds; also used as cleanup interval

// Private map: hostname → timestamp of last logged detection
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
    lastDetectedMap.set(safeLabel, now);
    console.error(`[injection-defense] [${safeLabel}] InjectionDetected`);
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
