// src/lib/types/public.ts
// Public API types for McpCurlServer extensible class

import type { CurlExecuteInput, JqQueryInput } from "../server/schemas.js";
import type { HostRateLimit } from "./rate-limit.js";

export type { HostRateLimit };

/**
 * Configuration options for McpCurlServer.
 * These settings affect how all tool calls are processed.
 */
export interface McpCurlConfig {
    /**
     * Base URL that a `url` starting with a single `/` is resolved against, in
     * `curl_execute` and `utilities().executeRequest`. An absolute URL passes
     * through unchanged: resolving against this URL does not limit hosts. But
     * with `allowedHosts` unset, the host list defaults to this URL's host alone,
     * so setting `baseUrl` refuses absolute URLs to any other host.
     */
    baseUrl?: string;
    /** Default headers for `curl_execute` and `utilities().executeRequest`; a request's own header of the same name wins */
    defaultHeaders?: Record<string, string>;
    /** Default timeout in seconds (1-300) for curl_execute */
    defaultTimeout?: number;
    /** Default output directory for saved responses */
    outputDir?: string;
    /** Default max result size in bytes before auto-saving to file */
    maxResultSize?: number;
    /** Allow localhost requests (overrides MCP_CURL_ALLOW_LOCALHOST env) */
    allowLocalhost?: boolean;
    /** HTTP transport port (default: 3000) */
    port?: number;
    /** HTTP transport bind address (default: "127.0.0.1") */
    host?: string;
    /** HTTP auth token (overrides MCP_AUTH_TOKEN env) */
    authToken?: string;
    /** Allowed origins for HTTP transport Origin header validation (default: localhost) */
    allowedOrigins?: readonly string[];
    /**
     * The hosts a request may go to, matched exactly, case-insensitively, with
     * trailing dots ignored. Entries are bare host names or IP literals (IPv6 in
     * brackets): no scheme, port, path, userinfo or wildcard, or `configure()`
     * throws. `"any"` allows every host; `[]` refuses every request.
     *
     * Unset, a server with a `baseUrl` may reach only the `baseUrl` host, and
     * `start()` throws if the `baseUrl` cannot give one; a server without a
     * `baseUrl` may reach any host. The list is checked against the request
     * URL's host before DNS, so a refused host is never resolved or contacted,
     * and again on every followed redirect hop's host. The SSRF gate applies on
     * top of this list either way.
     */
    allowedHosts?: readonly string[] | "any";
    /** Default User-Agent for all requests. Empty string disables. */
    defaultUserAgent?: string;
    /** Default Referer for all requests. Empty string disables. */
    defaultReferer?: string;
    /**
     * Per-host limit as a sliding window: at most `max` requests to any one
     * host in any `windowMs` span. Unset, each host gets the fixed default of
     * 60 per minute. `max` and `windowMs` must be positive integers, or
     * `configure()` throws. The per-client limit is not affected.
     *
     * Applied process-wide by `start()` and released only by this server's
     * `shutdown()` or failed `start()`, so it also counts `utilities()` calls,
     * YAML endpoint tools and any other server in the process. While one server
     * holds it, another's `start()` with a `rateLimit` throws. It is local
     * throttling, not quota accounting: the count starts again with the
     * process, and requests made elsewhere on the same credential are not seen
     * unless `syncFromHeaders` names the header carrying the upstream's own
     * remaining count. Give it the upstream's `quota` too when `max` is set
     * below it, or the sync spends that margin.
     */
    rateLimit?: HostRateLimit;
    /**
     * Text appended to the built-in `curl_execute` description, after its
     * version line — for what the model needs to know about the API this server
     * fronts: path prefixes, body shapes, pagination, which status means quota.
     * Trusted config: `configure()` replaces each run of Unicode attack
     * codepoints with a space, trims, and throws if the result exceeds `MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH`; it is
     * never truncated. Keep it short — it is sent on every turn of every session.
     */
    curlExecuteDescriptionAppend?: string;
    /**
     * Wrap responses in per-request sentinel tags to resist prompt injection
     * (spotlighting). Independent of the always-on defence pass — see the
     * **defence-in-depth wrap** below.
     *
     * **Defence-in-depth wrap.** Every tool result returned by this
     * server — `curl_execute`, `jq_query`, YAML-driven endpoints registered
     * via `createApiServer()`, custom tools registered via
     * `registerCustomTool()`, and synthesised results returned by a
     * `beforeRequest` short-circuit hook — is routed through a single
     * post-processor wrap (`src/lib/response/post-processor.ts`). The wrap
     * runs the full response-side defence pipeline on each text content part,
     * under the strictest grammar (this boundary's content type is always
     * undetermined), then optionally spotlights the result:
     *
     *   1. **Detect** injection patterns against the **original** text and its
     *      sanitised form, and emit a throttled `[injection-defense]` log
     *      line per hostname. A JSON part is also tested on each escaped
     *      string token, decoded on its own.
     *   2. **Sanitise** the text (strip Unicode attack chars, collapse
     *      whitespace runs).
     *   3. **Strip** markup comments, `<script>`/`<style>` blocks and markdown
     *      beacons (image / link / dangerous-scheme). The wrap does not decode
     *      HTML entities: its output is what gets returned, and on a channel
     *      whose consumer does not decode, a decode would manufacture live
     *      markup from inert bytes. So an entity-encoded beacon or `<script>`
     *      block survives this stage.
     *   4. **Re-sanitise and re-detect** the stripped text, so a phrase the
     *      strip stage joined still reaches the `[injection-defense]` log.
     *   5. **Spotlight** the defended text (only when this flag is `true`)
     *      using a fresh per-message UUID.
     *
     * Steps 1-4 run regardless of this flag — only step 5
     * (spotlighting sentinels) is gated — except above `STRIP_PATH_MAX_BYTES`
     * (256 KB), where a part takes Steps 1-2 alone, **and on a text part that parses
     * as JSON, where the wrap detects but rewrites nothing — no Unicode
     * sanitise and no markup, comment or markdown-beacon strip.** A JSON
     * document is returned to the model as the origin wrote it, because the
     * payload is the agent's to interpret (`LESSONS.md` RC-49) and rewriting a
     * value inside one silently corrupts an API payload: `stripHtmlComments` pairs `<!--` in
     * one field with `-->` in a later one and deletes what lies between. The
     * trade is deliberate and it is not free — a beacon or a `javascript:`
     * link inside a JSON string value reaches the model. Weigh that before
     * leaving spotlighting off.
     *
     * **"As the origin wrote it" includes Unicode attack codepoints.** A JSON
     * document carrying a literal U+200B or U+202E comes back with it, and
     * nothing reports the codepoint itself: the injection-detection log fires
     * only where one splits an injection phrase. `curl_execute` reports the
     * exceptions it can see: `body_decode_lossy` for a non-UTF-8 origin, and
     * `savedMessage` naming which form an artefact holds — the sanitised one
     * only for a non-JSON body Step 2 changed; a JSON document, a leading
     * U+FEFF included, is always saved as the origin's octets. The
     * wrap is idempotent via a
     * module-private, non-enumerable `Symbol` tag with an own-property check
     * (so the tag cannot be forged from outside the wrap module and an
     * inherited tag on a wrapped prototype cannot bypass processing of
     * descendant content), and is fail-open: if any internal step throws it
     * returns the original result unchanged and emits a throttled
     * `[wrap-error]` log line, so defence-in-depth never becomes a
     * load-bearing failure mode for the handler boundary.
     */
    enableSpotlighting?: boolean;
}

/**
 * Context provided to hooks during tool execution.
 * Contains tool name, parameters, session info, and current config.
 */
export interface HookContext<T = CurlExecuteInput | JqQueryInput> {
    /** Which tool is being executed */
    readonly tool: "curl_execute" | "jq_query";
    /** Tool parameters (may be modified by beforeRequest hooks) */
    params: T;
    /** Session ID for HTTP transport, undefined for stdio */
    readonly sessionId?: string;
    /** Current frozen configuration */
    readonly config: Readonly<McpCurlConfig>;
}

/**
 * Result type for beforeRequest hooks.
 * - void: continue with current params
 * - { params }: merge these params into current params
 * - { shortCircuit: true, response }: skip execution, return response immediately
 */
export type BeforeRequestResult<T> =
    | void
    | { params?: Partial<T> }
    | { shortCircuit: true; response: string; isError?: boolean };

/**
 * Hook called before tool execution.
 * Can modify params or short-circuit to return early.
 */
export type BeforeRequestHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T>
) => BeforeRequestResult<T> | Promise<BeforeRequestResult<T>>;

/**
 * Hook called once the tool returns, an `isError` result included; a tool
 * that throws reaches the onError hooks instead.
 * Receives the response for logging, metrics, caching, etc.
 *
 * `response` is the body, `content[0]`. `content` is every entry the tool
 * returns: `curl_execute` adds response header text and server-authored
 * notices as later entries, only when each has text, so a hook finds one by
 * matching its text rather than its index. A non-zero cURL exit sets `isError`;
 * its body may be empty, and its notice is in `content` alone. The
 * entries are frozen copies, so a hook cannot change the result it observes.
 */
export type AfterResponseHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T> & {
        response: string;
        content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
        isError: boolean;
    }
) => void | Promise<void>;

/**
 * Hook called when tool execution throws an error.
 * Receives the error for logging or handling.
 */
export type OnErrorHook<T = CurlExecuteInput | JqQueryInput> = (
    ctx: HookContext<T> & { error: Error }
) => void | Promise<void>;

/**
 * Transport mode for the MCP server.
 * - stdio: Standard input/output (default, for CLI usage)
 * - http: HTTP/SSE transport (for web clients)
 */
export type TransportMode = "stdio" | "http";

// Re-export input types for convenience
export type { CurlExecuteInput, JqQueryInput } from "../server/schemas.js";
