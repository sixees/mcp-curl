// src/lib/security/bounded-throttle.ts
// One implementation of "a process-lifetime throttle map must not grow without bound".

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
 * So the cap lives here, where no caller can forget it.
 * `SessionManager.set` is this same rule for sessions and is the precedent
 * this follows; the difference is the policy when full. Sessions **reject**,
 * because admitting one costs a transport. A log throttle **evicts**, because
 * the worst case is a single extra stderr line.
 *
 * **Not for rate-limit or quota maps.** Evicting a counter resets it, which
 * turns a bounded-memory fix into a bypass of the thing the counter enforces.
 * Those need the rejecting policy, not this one.
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
    // Only a new key can grow the map. Re-setting one that is already present
    // must never evict a bystander to make room for an entry needing no room.
    if (!map.has(key) && map.size >= THROTTLE.MAX_TRACKED_KEYS) {
        // Expired entries first: the common case is a process whose cleanup
        // interval was never started, so most of what is here is already stale.
        pruneExpired();
        if (map.size >= THROTTLE.MAX_TRACKED_KEYS) {
            // Still full: more distinct keys inside one window than we track.
            // Drop the first-inserted key. `Map` preserves insertion order and
            // re-setting a key keeps its original position, so this is
            // first-seen rather than least-recently-seen — the right trade for
            // a throttle, where the cost is one extra log line and never an
            // unbounded map.
            const oldest = map.keys().next().value;
            if (oldest !== undefined) map.delete(oldest);
        }
    }
    map.set(key, value);
}
