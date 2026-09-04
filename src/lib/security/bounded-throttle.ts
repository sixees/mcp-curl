// src/lib/security/bounded-throttle.ts
// The evicting half of "a process-lifetime map must not grow without bound".
// The rejecting half lives at its two call sites; see setBounded below.

import { THROTTLE } from "../config/session.js";

/**
 * Write into a process-lifetime throttle map, enforcing the entry cap at the
 * write rather than at the wiring.
 *
 * **The cleanup interval is not a bound, because starting it is a caller's job
 * and callers exist that do not.** `registerEndpointTools` is exported from
 * `mcp-curl` and `mcp-curl/schema` and reaches the wrap-error throttle through
 * `createToolHandler` → `createWrapper` without ever calling
 * `startWrapErrorCleanup`. `sanitizeAndDetect` is exported from `mcp-curl`
 * itself and reaches the detection throttle on an entry point that exports no
 * cleanup starter at all. On those paths the interval is not a weaker bound —
 * it is no bound, and the map grows one entry per distinct label for the life
 * of the process.
 *
 * **Evicting is safe here and nowhere else.** A throttle entry only suppresses
 * a log line, so dropping one costs at most one extra line of stderr. Two
 * siblings enforce a cap the same way but *reject* instead, because what they
 * hold cannot be dropped: `rate-limiter.ts::checkRateLimitInternal`, where
 * evicting a counter would reset it and bypass the limit, and
 * `session-manager.ts::SessionManager.set`, where admitting one costs a transport.
 *
 * @param map - the throttle map to write into
 * @param key - the entry key, already normalised by the caller
 * @param value - the entry value
 * @param pruneExpired - the map's own expiry sweep, tried before any eviction
 */
export function setBounded<V>(
    map: Map<string, V>,
    key: string,
    value: V,
    pruneExpired: () => void,
): void {
    // Only a new key can grow the map, so re-setting a resident one must never
    // cost a bystander its slot.
    if (!map.has(key) && map.size >= THROTTLE.MAX_TRACKED_KEYS) {
        // Expired entries first: the common case is a process whose cleanup
        // interval was never started, so most of what is here is already stale.
        pruneExpired();
        if (map.size >= THROTTLE.MAX_TRACKED_KEYS) {
            // Everything here is live, so something live has to go. `Map`
            // preserves insertion order and re-setting a key keeps its
            // position, making this first-seen rather than least-recently-seen
            // — which is the right victim for a throttle, where the entry is
            // only a memo and losing it costs one line.
            const oldest = map.keys().next().value;
            if (oldest !== undefined) map.delete(oldest);
        }
    }
    map.set(key, value);
}
