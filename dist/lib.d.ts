export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, c as HostRateLimit, I as InstanceUtilities, M as McpCurlConfig, d as McpCurlServer, O as OnErrorHook, T as TransportMode, e as createApiServer, f as createApiServerSync, g as createInstanceUtilities } from './api-server-Jm7p_Lxw.js';
export { A as ApiDefaults, a as ApiInfo, b as ApiSchema, c as ApiSchemaVersion, d as AuthConfig, e as AuthenticationError, C as CurlExecuteInput, E as EndpointDefinition, f as EndpointParameter, G as GeneratorConfig, H as HttpMethod, J as JqQueryInput, P as ParameterLocation, g as ParameterType, R as ResponseConfig, h as buildUrl, i as generateInputSchema, j as generateToolDefinitions, k as getAuthConfig, l as getMethodAnnotations, r as registerEndpointTools } from './generator-BBozd3k8.js';
export { ApiSchemaLoadError, ApiSchemaValidationError, ApiSchemaValidator, loadApiSchema, loadApiSchemaFromString, validateApiSchema } from './lib/schema/index.js';
import { z } from 'zod';
import '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Options for `createHttpOnlyUrlSchema`.
 */
interface CreateHttpOnlyUrlSchemaOptions {
    /**
     * Caller-facing description registered with Zod's `.describe()`. Surfaced to
     * MCP clients via `globalRegistry`, so phrase it in terms of *what the URL
     * is for* (e.g. "Base URL of the API"), not in terms of the scheme rule —
     * the scheme rule is enforced by this helper and shouldn't leak into every
     * call-site description.
     */
    description?: string;
    /**
     * Custom validation error message returned when the URL parses but uses a
     * disallowed scheme. Defaults to "URL must use http or https scheme".
     */
    message?: string;
}
/**
 * Create a Zod schema for a URL restricted to the http/https allowlist.
 *
 * Strict HTTP/HTTPS-only by design — the allowlist is the single source of
 * truth in `config/security/url-schemes.ts`, shared with the DNS layer
 * (`security/ssrf.ts`) and the cURL transport (`execution/curl-args-builder.ts`).
 * **Do not relax this helper to add `mailto:`, `data:`, etc. under pressure.**
 * If a different allowlist is ever needed, add a separate
 * `createUrlSchemaWithSchemes(allowedSchemes, options)` factory rather than
 * widening the strict default — defence-in-depth across three layers depends
 * on this list staying narrow.
 *
 * Validation logic:
 * - `z.url()` accepts any WHATWG-valid URL (including `javascript:`, `data:`,
 *   `ftp://`); the `.refine()` is the sole scheme enforcement at the schema
 *   layer.
 * - Uses the WHATWG URL parser (matching `security/ssrf.ts` and Node fetch),
 *   so a URL that string-splits to "http:" but parses to a different scheme
 *   cannot pass the schema and surprise the SSRF check.
 *
 * **Defense-in-depth, not invariant equivalence.** This helper is one of three
 * independent enforcement points (schema → DNS/SSRF → cURL `--proto`); each
 * is sufficient on its own to reject a non-http(s) request. The layers share
 * the `ALLOWED_URL_SCHEMES` allowlist, but they do not share representation —
 * for example, WHATWG canonicalises IPv4-mapped IPv6 hosts to compressed hex
 * (`[::ffff:7f00:1]`), so the SSRF blocklist must normalise that form before
 * pattern-matching against the dotted-quad rules. If a future change moves
 * one layer to a different parser or representation, the others must continue
 * to hold the line.
 *
 * Return type is pinned to `z.ZodType<string>` rather than the inferred
 * `ZodURL` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * **Build the schema once at module load and reuse the reference.** Each
 * invocation constructs a new schema and registers it with Zod's
 * `globalRegistry` (via `.describe()`). That registry holds schemas weakly, so
 * a per-request call does not leak, but it repeats the construction on every
 * request for an identical result.
 *
 * @param options - Optional configuration for the schema's caller-visible text.
 * @param options.description - Forwarded to Zod's `.describe()`. Becomes the
 *   JSON Schema `"description"` field that LLM clients render in tool input
 *   docs. Should describe what the URL is *for*; the http(s) constraint is
 *   enforced by the helper itself and shouldn't leak into every call-site
 *   description. Defaults to `"URL (http or https)"`.
 * @param options.message - Validation error message returned when the URL
 *   parses but uses a disallowed scheme. Defaults to
 *   `"URL must use http or https scheme"`.
 * @returns A Zod schema (`z.ZodType<string>`) accepting only http/https URLs.
 *   URL-format failures emit `"Must be a valid URL"`; scheme-rejection failures
 *   emit `options.message`.
 */
declare function createHttpOnlyUrlSchema(options?: CreateHttpOnlyUrlSchemaOptions): z.ZodType<string>;
/**
 * Extract a hostname from a URL string, or `fallback` (default: "unknown")
 * when the URL is malformed or missing. Never throws, so an error path keeps a
 * stable log label without a URL-parse failure shadowing the original error.
 * `executeCurlRequest` also reads it for the host-list check, passing `""` so
 * an unparseable URL is told apart from a real host and left to the SSRF gate.
 *
 * Pure: depends only on its inputs.
 */
declare function safeHostname(url: string | undefined, fallback?: string): string;

/**
 * Maximum length for custom tool descriptions.
 * Clients (OpenAI-compatible) truncate descriptions beyond ~1024 chars;
 * staying under 1000 provides a safe margin.
 */
declare const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;
/**
 * Maximum length of `McpCurlConfig.curlExecuteDescriptionAppend`, after sanitising.
 * A budget choice, not a client limit: the client rationale above covers a whole
 * custom-tool description, while the built-in curl_execute description is already
 * several KB. The append loads on every turn of every session, so this is a
 * ceiling against runaway prompt cost, not a target.
 */
declare const MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH = 8000;
/**
 * Sanitize a string for use in tool metadata or prompt templates.
 * Strips dangerous Unicode attack vectors (bidi overrides, zero-width chars, soft hyphen,
 * variation selectors, Tags block) while preserving normal whitespace (\t, \n, \r, space)
 * and all printable characters.
 *
 * @param input - String to sanitize (null/undefined returns "")
 * @returns Sanitized string with attack characters replaced by space, then trimmed
 */
declare function sanitizeDescription(input: string | null | undefined): string;
/**
 * Sanitize HTTP response content before returning to LLM.
 *
 * Per-pass sanitization:
 * 1. Unicode attack vectors (bidi overrides, zero-width chars, Tags block,
 *    Variation Selectors Supplement / "Sneaky Bits", Braille blank, Arabic
 *    letter mark, Mongolian invisibles, Hangul fillers, …) → removed
 * 2. Whitespace-padding runs (50+ consecutive characters from the visual-space
 *    class — ASCII space, tab, NBSP, U+2000–U+200A en/em-spaces, U+202F NARROW
 *    NO-BREAK SPACE, U+205F MEDIUM MATHEMATICAL SPACE, U+3000 IDEOGRAPHIC
 *    SPACE) → collapsed to a single ASCII space.
 * 3. Newline runs (20+ consecutive `\n`) → collapsed to a single `\n`. Preserves
 *    rough document structure while defeating context-window-eviction attacks
 *    that push trailing content past the visible scroll.
 *
 * **Idempotence loop (≤4 iterations).** A single pass is vulnerable to
 * attack-char interleaving: an attacker can construct
 * `(49 spaces + ZWSP) × N` where each ZWSP is in the Unicode-attack class
 * and each 49-space run is below the 50+ threshold. Single-pass: ZWSPs are
 * removed individually, 49-space runs are preserved verbatim, and the
 * concatenated output is a 49×N-character whitespace run that survived the
 * 50+ rule. The loop re-runs sanitise until the output stabilises (`next ===
 * curr`) or the cap fires; in practice 2 iterations close the
 * interleaving class. Each iteration is O(n) so worst-case work is bounded.
 *
 * Normal short whitespace (single `\t`, `\n`, `\r`, runs below threshold) is
 * preserved to maintain response formatting.
 *
 * Whitespace runs collapse to a single ASCII space (rather than a marker like
 * "[WHITESPACE REMOVED]") because callers may JSON.parse the sanitized output
 * (`response/processor.ts → processResponse` runs a `jq_filter` over its
 * post-sanitise body, and writes that body to disk). Inserting a non-whitespace
 * marker into the middle of a JSON document — between tokens or inside a deeply
 * pretty-printed value — would break the parse. A single space preserves
 * JSON validity while still neutralising the padding attack (the hidden tail
 * is no longer hidden behind a wall of whitespace), and detectInjectionPattern
 * still fires on the collapsed content for observability. Newline runs collapse
 * to `\n` for the same reason — preserving JSON validity for prettified bodies
 * with intentional line breaks.
 *
 * **Stability contract:** the security *invariant* is stable across versions —
 * output never contains Unicode-attack chars from the documented class, never
 * contains a run of 50+ consecutive whitespace characters from the visual-space
 * class, never contains a run of 20+ consecutive newlines. The exact
 * *byte-level form* of the transformation is implementation detail and may
 * tighten over time (broader Unicode coverage, lower thresholds, additional
 * collapses). Do not rely on `sanitizeResponse(x) === x` as a "is clean"
 * oracle — re-run the sanitiser instead, or compose with `sanitizeAndDetect`.
 *
 * @param input - Response content to sanitize (null/undefined returns "")
 * @returns Sanitized content
 */
declare function sanitizeResponse(input: string | null | undefined): string;
/**
 * Scan content for prompt injection patterns.
 *
 * **Observability only — never use this as an enforcement gate.** Pattern
 * matching is a signal, not a boundary: it has known false positives, is
 * trivially bypassed by a motivated attacker (paraphrase, encoding, novel
 * jailbreak phrasing), and gating on it leaks the rule-set to whoever can
 * probe the behaviour. The defence layer is `sanitizeResponse` (Unicode
 * normalisation), which runs on every non-JSON text part, plus
 * `applySpotlighting` (trust-boundary sentinel), which runs only where
 * `enableSpotlighting` is set — neither is gated on detection state, and a
 * JSON document is returned unchanged with detection alone. Examples of misuse:
 *
 *     // ❌ Never do this — converts a signal into a refusal gate.
 *     if (detectInjectionPattern(externalContent)) {
 *         return { isError: true, content: [{ type: "text", text: "Refused" }] };
 *     }
 *
 *     // ❌ Never do this — silently drops content the LLM should have seen.
 *     return detectInjectionPattern(text) ? "[content removed]" : text;
 *
 *     // ✅ Correct — log only; sanitised text is still returned.
 *     if (detectInjectionPattern(sanitized)) console.error(...);
 *     return sanitized;
 *
 * Prefer the `sanitizeAndDetect(text, label)` composer (re-exported from the
 * public barrel) over hand-wiring the primitives — it detects on the
 * **original** text and on its sanitised form, then returns the sanitised
 * bytes the LLM actually sees (see `detection-logger.ts → detectAndLog`,
 * which owns why both). Calling this matcher on one form alone covers only
 * the class that form shows; `@param input` below names both.
 *
 * **Normalisation.** The matcher normalises its input
 * before testing the pattern set, currently via
 * `String.prototype.normalize("NFKC")`. NFKC collapses compatibility
 * variants — full-width letters (`ｉｇｎｏｒｅ`), ligatures (`ﬁ`), and
 * ASCII-mappable Latin compat forms — into canonical ASCII so the
 * homoglyph-substitution bypass class is closed. **Returned content is
 * unchanged** — normalisation is applied to a transient string used for
 * matching only; `sanitizeResponse`'s output (the bytes the LLM actually
 * sees) never goes through it. NFKC can expand input length under
 * compatibility decomposition (e.g. `ﬃ` → `ffi`, ~3× worst case); the
 * transient is bounded by the upstream `LIMITS.MAX_RESPONSE_SIZE`
 * (10 MB) cap and collected immediately after `.test()` returns, so the
 * memory footprint stays well inside `MAX_TOTAL_RESPONSE_MEMORY`
 * (100 MB). UTS #39 confusable folding (Cyrillic/Greek look-alikes like
 * `і`, `а`, `р`) is NOT covered by NFKC and remains a documented gap,
 * pinned by the `documents NFKC's UTS #39 limit` case in
 * `sanitize.test.ts`.
 *
 * **Stability contract:** the *intent* — return `true` when the
 * provided input (the original or the sanitised form, both of which
 * `sanitizeAndDetect` tests) matches a known prompt-injection
 * signal, and never mutate the bytes flowing through `sanitizeResponse`
 * — is stable. The specific pattern set and the specific normalisation
 * algorithm (currently NFKC) are **implementation**: the pattern set
 * will expand as new attack phrasings emerge, and the normaliser may
 * swap to UTS #39 skeleton-folding once the gap-trigger surfaces. The
 * no-content-mutation invariant is locked by an executable test
 * (`sanitize.test.ts > does NOT mutate input`). Tests that assert on
 * which strings do or do not match should target known categories
 * (e.g. instruction-override phrases) rather than exact wording, and
 * callers must continue to honour the "observability only" rule
 * regardless of which patterns are in play.
 *
 * @param input - Content to scan. The production path,
 *   `detection-logger.ts → detectAndLog`, calls this on the original text
 *   AND on its `sanitizeResponse` form, because each representation hides a
 *   class from the other: a phrase spaced with a `\s`-matching character the
 *   sanitiser removes (U+2028, U+2029, U+FEFF) is whole only in the original,
 *   and a phrase an invisible character
 *   splits (`Ig`+ZWSP+`nore`) is whole only in the sanitised form. A direct
 *   caller wanting both classes does the same.
 * @returns true if any injection pattern matched
 */
declare function detectInjectionPattern(input: string): boolean;
/**
 * Wrap response content with per-request trust-boundary sentinels (spotlighting).
 *
 * Uses opaque UUID-based delimiters that cannot appear naturally in text or markup,
 * preventing a hostile payload from terminating the sentinel region early.
 * XML-style tags (`<response>...</response>`) are NOT used because a payload containing
 * `</response>` would break out of the trusted region.
 *
 * Uses the caller-provided requestId (a fresh UUID per request, never a module-level constant)
 * to make cross-turn sentinel reuse attacks impractical.
 *
 * **Idempotence:** if `content` is already a *complete* spotlight envelope
 * (`isSpotlightEnvelope(content)` returns `true`), the function returns it
 * unchanged. The check requires both the begin sentinel AND a matching end
 * sentinel with the same UUID — an attacker prepending only the public begin
 * prefix cannot bypass spotlighting. `response/post-processor.ts → createWrapper`
 * also short-circuits when the inner result is already wrapped — both layers
 * defend against double-wrapping (which would otherwise nest two different
 * UUID sentinels and confuse the LLM about where the trust boundary lies).
 *
 * **Stability contract:** the *security property* — output marks the content
 * with a per-request, unguessable, unspoofable trust boundary — is stable. The
 * exact sentinel string format (current: `---EXTERNAL-CONTENT-BEGIN-{uuid}---`)
 * is implementation detail and may change in a future minor release (e.g. to
 * a JSON envelope or a randomised byte prefix) without breaking the contract.
 * Downstream prompt templates **must not** match on the literal sentinel
 * string — treat the wrapped content as opaque and pass it through to the LLM
 * unchanged.
 *
 * @param content - Response content to wrap
 * @param requestId - Unique identifier for this response (caller should pass randomUUID());
 *                   must match `SPOTLIGHT_REQUEST_ID_PATTERN` (32-hex or RFC 4122
 *                   8-4-4-4-12 UUID shape) so a degraded sentinel cannot ship
 * @returns Content wrapped in opaque sentinel delimiters, or `content` unchanged if it is already wrapped
 */
declare function applySpotlighting(content: string, requestId: string): string;

/**
 * Log a prompt injection detection event, throttled to once per hostname per minute.
 * Logs only the hostname and event class — never the matched phrase content,
 * which could itself contain injection payloads.
 *
 * @param hostname - Target hostname where the pattern was detected
 */
declare function logInjectionDetected(hostname: string): void;
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
declare function sanitizeAndDetect(text: string, label: string): string;

export { type CreateHttpOnlyUrlSchemaOptions, MAX_CURL_EXECUTE_DESCRIPTION_APPEND_LENGTH, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH, applySpotlighting, createHttpOnlyUrlSchema, detectInjectionPattern, logInjectionDetected, safeHostname, sanitizeAndDetect, sanitizeDescription, sanitizeResponse };
