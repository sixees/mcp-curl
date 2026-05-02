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
// 3. **Idempotence via a module-private `Symbol("mcp-curl.wrapped")`.** A
//    `CallToolResult` that has already passed through wrap carries a
//    non-enumerable symbol tag. Subsequent wrap calls short-circuit (using
//    an own-property check via `Object.hasOwn` so an inherited tag from a
//    wrapped prototype cannot bypass processing) and return the result
//    unchanged. This lets the YAML path (which wraps inside
//    `createToolHandler` *and* again at custom-tool registration) avoid
//    double-sanitising or double-spotlighting the same response.
//
//    The symbol is **not** `Symbol.for(...)` — that would put it in the
//    global registry and let any custom-tool author synthesise the same
//    key and pre-tag a result to bypass sanitise/detect/spotlight.
//    Module-private means `tag()` in this file is the only path by which
//    the WRAPPED bit is ever set.
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

// Module-private symbol — deliberately NOT `Symbol.for()`. The global symbol
// registry is reachable from any code path that runs in this realm, including
// custom-tool handlers registered by library consumers. With `Symbol.for()` a
// hostile (or careless) custom tool could synthesise the same key and tag its
// own returned result, causing the registration wrap to short-circuit and
// reach the LLM with no sanitise / no detect / no spotlight. Using a
// module-private symbol means the only way to set the tag is to call `tag()`
// inside this module, which only happens after the wrap pipeline has run (or
// after a fail-open catch). The trade-off — that the tag does not survive
// across module duplication (HMR, dual ESM/CJS resolution) — is acceptable
// because the tag is a per-process performance optimisation; if it's lost,
// the wrap re-runs and is semantically idempotent.
const WRAPPED = Symbol("mcp-curl.wrapped");

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
 * text tuple) and the SDK's `CallToolResult` (multi-part array).
 *
 * `text?: string` (not `unknown`) — the runtime guard inside `processTextPart`
 * already enforces the string check, so the type can be tight; downstream
 * consumers no longer need a redundant `typeof === "string"` check.
 */
export interface WrappableContentPart {
    type: string;
    text?: string;
    [key: string]: unknown;
}

/**
 * `_meta` and `structuredContent` are explicitly enumerated to lock the
 * contract that the wrap preserves these SDK 1.x fields by reference. Without
 * them the index signature alone would also carry them through, but a future
 * refactor that switches from spread to explicit field copying would silently
 * drop them. Naming them protects the SDK shape.
 */
export interface WrappableResult {
    content?: WrappableContentPart[];
    isError?: boolean;
    _meta?: { [k: string]: unknown };
    structuredContent?: { [k: string]: unknown };
    [key: string]: unknown;
}

/**
 * Safe own-property probe for the WRAPPED tag.
 *
 * `Object.hasOwn` triggers the target's `getOwnPropertyDescriptor` trap on a
 * Proxy. A hostile or buggy custom-tool author can return a Proxy whose trap
 * throws, which would propagate out of `isWrappedResult` / `tag` and break the
 * documented fail-open contract — the wrap must never throw at the handler
 * boundary. Wrapping the probe in try/catch keeps the failure contained: an
 * un-probable result is treated as untagged, so the wrap pipeline runs
 * normally and the outer try/catch handles any subsequent failure.
 *
 * Also reads the symbol value defensively — accessing `result[WRAPPED]` on a
 * Proxy invokes the `get` trap, which can also throw.
 */
function hasOwnWrappedTag(result: object): boolean {
    try {
        return (
            Object.hasOwn(result, WRAPPED) &&
            (result as { [WRAPPED]?: unknown })[WRAPPED] === true
        );
    } catch {
        return false;
    }
}

/**
 * Read-only check: has this result been wrapped already?
 *
 * Uses `Object.hasOwn` rather than a direct `result[WRAPPED]` read because
 * symbol-keyed property access traverses the prototype chain. An object
 * whose prototype was wrapped at some earlier point would inherit the tag
 * and bypass the wrap on its own (un-processed) content. Restricting to own
 * properties means the only way the tag is set is via `tag()` in this
 * module after the pipeline has run.
 *
 * The probe itself is wrapped in try/catch via `hasOwnWrappedTag` so a
 * hostile Proxy with a throwing trap cannot break fail-open.
 *
 * Exported for tests; production callers should rely on the wrap's own
 * short-circuit rather than branching on the tag.
 */
export function isWrappedResult(result: unknown): boolean {
    if (result === null || typeof result !== "object") return false;
    return hasOwnWrappedTag(result);
}

/**
 * Mark a result as wrapped. Non-enumerable so spreads, JSON serialisation, and
 * shallow inspection do not see the tag.
 *
 * `Object.defineProperty` throws on non-extensible results (frozen, sealed,
 * or Proxy-blocked). Defence-in-depth must never propagate exceptions to the
 * handler boundary, so we swallow the defineProperty failure here. The
 * trade-off: a downstream wrap on the same frozen result will re-run the
 * pipeline. That is semantically harmless because `sanitizeResponse` is
 * idempotent on already-sanitised text and `applySpotlighting` short-circuits
 * on already-wrapped envelopes — the worst case is one extra O(n) pass over
 * the body, never a correctness issue.
 *
 * The own-tag probe is also routed through `hasOwnWrappedTag` so a hostile
 * Proxy whose `getOwnPropertyDescriptor` / `get` trap throws cannot break
 * the catch-fallback path that calls `tag(result)`.
 */
function tag<T extends object>(result: T): T {
    // Own-property check (not prototype-chain): same reasoning as
    // `isWrappedResult` — an inherited tag must not short-circuit a real
    // pipeline run on the descendant.
    if (hasOwnWrappedTag(result)) return result;
    try {
        Object.defineProperty(result, WRAPPED, {
            value: true,
            enumerable: false,
            configurable: true,
            writable: false,
        });
    } catch {
        // Non-extensible target or throwing Proxy trap — see doc comment
        // above. Pass through.
    }
    return result;
}

function processTextPart(
    part: unknown,
    hostname: string,
    requestId: string | undefined
): unknown {
    // Defensive: a single null/undefined or non-object content entry must
    // not throw out of `.map()` and abort the wrap for the entire result.
    // Non-text parts (and malformed entries) pass through unchanged so the
    // valid text parts still get sanitise + detect + spotlight.
    if (part === null || typeof part !== "object") return part;
    const contentPart = part as WrappableContentPart;
    if (contentPart.type !== "text" || typeof contentPart.text !== "string") {
        return contentPart;
    }
    const sanitised = sanitizeAndDetect(contentPart.text, hostname);
    const finalText = requestId ? applySpotlighting(sanitised, requestId) : sanitised;
    return { ...contentPart, text: finalText };
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
            // Defensive: the SDK's CallToolResult has `content` as an array,
            // but a custom-tool author could return a malformed shape. Tag
            // and pass through rather than throw — a malformed result is the
            // handler's problem, not the wrap's responsibility to "fix."
            if (!Array.isArray(result.content)) return tag(result);

            // Per-message UUID (A11): one UUID per wrap call, shared by every
            // text part of this result. Generated only when spotlighting is
            // enabled AND this is not an error result — error text is a
            // status message about the call, not external content the LLM
            // should treat as untrusted with sentinel boundaries. Sanitise +
            // detect still run on errors below: a buggy or hostile custom
            // tool / YAML handler / hook short-circuit could otherwise emit
            // `{ isError: true, content: [{ text: <attacker bytes> }] }`
            // and bypass the defence-in-depth pass entirely.
            const requestId =
                config.enableSpotlighting && !result.isError ? randomUUID() : undefined;

            const newContent = result.content.map((part) =>
                processTextPart(part, hostname, requestId)
            );
            // Spread + content replacement preserves every other field
            // (`_meta`, `structuredContent`, etc.) by reference. The cast is
            // load-bearing here because TypeScript widens `T & { content: … }`
            // back to `WrappableResult` through the index signature; the spread
            // shape matches `T` structurally at runtime.
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
