// src/lib/response/post-processor.ts
// Defence-in-depth wrap for tool results (PR-6b / B3).
//
// `createWrapper(config)` returns a closure `wrap(result, hostname)` that runs
// the three response-side defences (sanitise + detect + optional spotlight)
// over each text content part of a `CallToolResult`. Server-scope config (the
// spotlighting flag) is bound once at server creation; request-scope hostname
// is passed per call so the per-host injection-detection throttle keys
// correctly.
//
// Design notes:
//
// 1. **Single chokepoint, multiple call sites.** The same closure is invoked
//    from `tool-wrapper.ts` (curl_execute / jq_query), the YAML
//    `createToolHandler` in `schema/generator.ts`, the custom-tool
//    registration adapter in `extensible/mcp-curl-server.ts`, and the
//    short-circuit return path in `extensible/hook-executor.ts`. Symbol-tag
//    idempotence (see point 3) lets these compose freely.
//
// 2. **Detect-on-original ordering (S4).** The wrap delegates the
//    sanitise/detect step to `sanitizeAndDetect()` in
//    `security/detection-logger.ts`, which now detects on the **original**
//    text before sanitisation. Future PRs (B7/B8) will add stripping passes
//    that erase the very byte sequences the detector looks for; running
//    detection first preserves the log signal.
//
// 3. **Idempotence via `Symbol.for("mcp-curl.wrapped")`.** A `CallToolResult`
//    that has already passed through wrap carries a non-enumerable symbol
//    tag. Subsequent wrap calls short-circuit and return the result
//    unchanged. This lets the YAML path (which wraps inside
//    `createToolHandler` *and* again at custom-tool registration) avoid
//    double-sanitising or double-spotlighting the same response.
//
// 4. **Fail-open with observability.** The wrap body is enclosed in a
//    try/catch. On any internal error (regex pathological-backtracking
//    abort, unexpected content shape, malformed sanitiser output), the
//    original `result` is returned unchanged and a single throttled
//    `[wrap-error] [hostname] ErrorClassName` line is emitted via
//    `logWrapError`. Defence-in-depth must never become a load-bearing
//    dependency that can break the handler boundary.
//
// 5. **Per-message UUID for spotlighting (A11).** When spotlighting is
//    enabled, a fresh `randomUUID()` is generated **per `wrap()` call** (one
//    UUID for the whole call, shared by every text part of that result) so
//    the begin/end sentinels match within a single response and a hostile
//    upstream cannot recycle a leaked UUID across responses.

import { randomUUID } from "node:crypto";
import { sanitizeAndDetect } from "../security/detection-logger.js";
import { logWrapError } from "../security/wrap-error-logger.js";
import { applySpotlighting } from "../utils/sanitize.js";

const WRAPPED = Symbol.for("mcp-curl.wrapped");

/**
 * Server-scope config bound once at wrapper creation.
 *
 * `enableSpotlighting` mirrors `McpCurlConfig.enableSpotlighting` — when
 * `true`, sanitised text parts are also wrapped in spotlighting sentinels;
 * when `false`/`undefined`, sanitise + detect still run.
 */
export interface WrapperConfig {
    enableSpotlighting?: boolean;
}

/**
 * Minimal shape compatible with both the internal `ToolResult` (single-element
 * text tuple) and the SDK's `CallToolResult` (multi-part array). Typed
 * permissively so callers can pass either without casts; the wrap returns the
 * same `T` it received.
 */
export interface WrappableContentPart {
    type: string;
    text?: unknown;
    [key: string]: unknown;
}

export interface WrappableResult {
    content?: WrappableContentPart[] | unknown;
    isError?: boolean;
    [key: string]: unknown;
}

/**
 * Read-only check: has this result been wrapped already?
 *
 * Exported for tests; production callers should rely on the wrap's own
 * short-circuit rather than branching on the tag.
 */
export function isWrappedResult(result: unknown): boolean {
    if (result === null || typeof result !== "object") return false;
    return (result as { [WRAPPED]?: unknown })[WRAPPED] === true;
}

/**
 * Mark a result as wrapped. Non-enumerable so spreads, JSON serialisation, and
 * shallow inspection do not see the tag.
 */
function tag<T extends object>(result: T): T {
    if ((result as { [WRAPPED]?: unknown })[WRAPPED] === true) return result;
    Object.defineProperty(result, WRAPPED, {
        value: true,
        enumerable: false,
        configurable: true,
        writable: false,
    });
    return result;
}

function processTextPart(
    part: WrappableContentPart,
    hostname: string,
    requestId: string | undefined
): WrappableContentPart {
    if (part.type !== "text" || typeof part.text !== "string") {
        return part;
    }
    const sanitised = sanitizeAndDetect(part.text, hostname);
    const finalText = requestId ? applySpotlighting(sanitised, requestId) : sanitised;
    return { ...part, text: finalText };
}

/**
 * Build a defence-in-depth wrapper for tool results.
 *
 * Returns a closure that takes a tool result and the hostname the request was
 * directed at, and returns a new wrapped result whose text parts have been
 * sanitised, detected, and (optionally) spotlighted. The closure is safe to
 * call repeatedly on the same result thanks to symbol-tag idempotence.
 *
 * The hostname is passed per call (rather than bound into the closure) so a
 * single wrapper instance can serve many request hostnames — and so the
 * per-hostname injection-detection throttle keys correctly.
 *
 * @param config - Server-scope wrap configuration
 * @returns Per-call wrap function
 */
export function createWrapper(
    config: WrapperConfig
): <T extends WrappableResult>(result: T, hostname: string) => T {
    return function wrap<T extends WrappableResult>(result: T, hostname: string): T {
        // Cheap guard: non-objects (or null) cannot carry a wrap tag and have
        // no content to process — return as-is so the caller sees the same
        // value it would have without us.
        if (result === null || typeof result !== "object") return result;
        if (isWrappedResult(result)) return result;

        try {
            // Errors pass through unchanged — error text is internally
            // generated, doesn't carry external content, and re-running
            // detection would only produce noise. Tag so a downstream wrap is
            // still a no-op.
            if (result.isError) return tag(result);

            // Defensive: the SDK's CallToolResult has `content` as an array,
            // but a custom-tool author could return a malformed shape. Tag
            // and pass through rather than throw — a malformed result is the
            // handler's problem, not the wrap's responsibility to "fix."
            if (!Array.isArray(result.content)) return tag(result);

            // Per-message UUID (A11): one UUID per wrap call, shared by every
            // text part of this result. Generated only when spotlighting is
            // enabled to avoid the entropy draw on the no-op path.
            const requestId = config.enableSpotlighting ? randomUUID() : undefined;

            const newContent = (result.content as WrappableContentPart[]).map((part) =>
                processTextPart(part, hostname, requestId)
            );
            return tag({ ...result, content: newContent } as T);
        } catch (err) {
            // Defence-in-depth must never propagate exceptions to the handler
            // boundary. Log once per hostname (throttled) and pass the
            // original result through unchanged. Tag so a downstream wrap
            // sees the failure mode and short-circuits too.
            logWrapError(hostname, err);
            return tag(result);
        }
    };
}
