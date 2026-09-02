export { A as AfterResponseHook, B as BeforeRequestHook, a as BeforeRequestResult, C as CreateApiServerOptions, b as CustomToolMeta, E as ExecuteRequestParams, H as HookContext, I as InstanceUtilities, M as McpCurlConfig, c as McpCurlServer, O as OnErrorHook, T as TransportMode, d as createApiServer, e as createApiServerSync, f as createInstanceUtilities } from './api-server-DP1_eKrs.js';
export { A as ApiDefaults, c as ApiInfo, d as ApiSchema, f as ApiSchemaVersion, g as AuthConfig, h as AuthenticationError, C as CurlExecuteInput, E as EndpointDefinition, i as EndpointParameter, G as GeneratorConfig, H as HttpMethod, J as JqQueryInput, P as ParameterLocation, j as ParameterType, R as ResponseConfig, k as buildUrl, l as generateInputSchema, m as generateToolDefinitions, n as getAuthConfig, o as getMethodAnnotations, r as registerEndpointTools } from './generator-D-A-xhiq.js';
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
 * `ZodEffects<ZodURL>` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * **Intended for module-level use only.** Each invocation registers the
 * resulting schema with Zod's `globalRegistry` (via `.describe()`); calling
 * this per-request would accumulate entries that the registry never reclaims.
 * Build the schema once at module load and reuse the reference.
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
 * Extract a hostname from a URL string for use as a log label.
 * Returns the configured fallback (default: "unknown") if the URL is malformed
 * or missing — used in error paths where we still want a stable label without
 * letting URL-parse failures shadow the original error.
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
 * Sanitize a string for use in tool metadata or prompt templates.
 * Strips dangerous Unicode attack vectors (bidi overrides, zero-width chars, soft hyphen,
 * variation selectors, Tags block) while preserving normal whitespace (\t, \n, \r, space)
 * and all printable characters.
 *
 * @param input - String to sanitize (null/undefined returns "")
 * @returns Sanitized string with attack characters replaced by space
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
 * (see response/processor.ts → applyJqFilterToParsed). Inserting a non-whitespace
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
 * normalisation) plus `applySpotlighting` (trust-boundary sentinel) — both
 * always run regardless of detection state. Examples of misuse:
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
 * public barrel) over hand-wiring the primitives — it locks the project's
 * canonical detect-then-sanitise ordering: detection runs on the **original**
 * text (so signals the sanitiser would later strip — e.g. the
 * U+2026-prefixed payloads PR-7 added to the attack-range — still fire the
 * per-host log) and sanitisation produces the bytes the LLM actually sees
 * (see PR-6b S4 in `detection-logger.ts → sanitizeAndDetect`). Calling this
 * matcher directly on **already-sanitised** text trades that signal-
 * preservation for invisible-char-split coverage instead: phrases like
 * "Ig​nore" (zero-width space splitting `ignore`) collapse to `Ignore`
 * after sanitisation and become detectable. Both call shapes are
 * legitimate; pick based on which class you care about preserving.
 *
 * **Normalisation (PR-8 / B7-sub-4).** The matcher normalises its input
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
 * `і`, `а`, `р`) is NOT covered by NFKC and remains a documented gap;
 * see the comment on `INJECTION_PATTERNS` above for the deferral
 * rationale.
 *
 * **Stability contract:** the *intent* — return `true` when the
 * provided input (either the original text via `sanitizeAndDetect` or
 * pre-sanitised text via direct call) matches a known prompt-injection
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
 * @param input - Content to scan. When called via `sanitizeAndDetect`
 *   (the canonical production path), detection runs on the **original**
 *   text before sanitisation — preserving signals like Unicode-attack
 *   payloads that the sanitiser would otherwise strip. When called
 *   directly, passing content already through `sanitizeResponse` improves
 *   coverage of invisible-char-split phrases (e.g. `Ig`+ZWSP+`nore` →
 *   `Ignore`), at the cost of the pre-sanitise signal class. Both shapes
 *   are valid; pick based on which class you care about. See PR-6b S4
 *   in `detection-logger.ts` for the ordering rationale.
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
 * prefix cannot bypass spotlighting. The `extensible/tool-wrapper` also
 * short-circuits when the inner result is already wrapped — both layers
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
 *                   must match `/^[0-9a-f-]{32,36}$/i` so a degraded sentinel cannot ship
 * @returns Content wrapped in opaque sentinel delimiters, or `content` unchanged if it is already wrapped
 */
declare function applySpotlighting(content: string, requestId: string): string;

/**
 * Options for {@link defendText}.
 */
interface DefendTextOptions {
    /** Content-Type of the text, used to select the strip stages. */
    contentType?: string;
    /** Hostname label for injection-detection logging. */
    hostname: string;
    /**
     * True when the content type could not be DETERMINED, as distinct from the
     * origin simply not sending one.
     *
     * Losing our own metadata must never be a way to switch a defence off. When
     * the content type is unknown the strictest grammar applies, so every strip
     * stage runs — the opposite of the permissive default, which let a remote
     * disable beacon stripping by making the metadata unreadable.
     *
     * **Required, not optional, and that is the whole point.** Both fields that
     * select the grammar are absent-able, and absence resolved to the
     * PERMISSIVE arm — so `defendText(text, { hostname })` compiled, looked
     * defended, and ran Step 2 alone. Pass `false` when you know the content
     * type (including knowing the origin sent none), `true` when you could not
     * determine it.
     *
     * **The type is only half the fix, because a type is not a runtime check.**
     * 3.4.0 publishes this function, and a JavaScript consumer can omit the
     * field whatever the declaration says. So omission resolves to the
     * strictest grammar at runtime as well — see the destructuring default in
     * `defendText`. Both halves are needed: the type tells a TypeScript caller
     * to decide, and the default decides safely for a caller who did not.
     */
    contentTypeUndetermined: boolean;
    /**
     * Whether a text that parses as a JSON document is exempt from the markup
     * and markdown strip stages. Defaults true.
     *
     * **The exemption is about the artefact, not the model.** `processResponse`
     * writes post-strip content to disk and `jq_query` reads it back, so
     * rewriting `<script>` or `[a](b)` inside a JSON string value there would
     * silently alter a persisted document. That argument is the whole basis for
     * the exemption — and it does not reach the post-processor wrap, whose
     * channels have no disk artefact: a custom tool's return goes straight to
     * the model. The wrap therefore passes `false`. See `LESSONS.md` RC-10.
     */
    excludeJsonDocuments?: boolean;
    /**
     * Whether to decode numeric HTML entities during the block strip.
     *
     * **Defaults true, and must be false for any channel whose consumer does
     * not itself decode.** The decode is not a scratch copy: its result is what
     * gets returned. On a body bound for a renderer that would decode anyway,
     * that is correct and is what lets Step 5 catch `&#x69;gnore previous
     * instructions`. On a channel like response headers it is additive — it
     * turns inert text the origin sent into live markup we authored.
     */
    decodeEntities?: boolean;
}
declare function defendText(text: string, options: DefendTextOptions): string;

/**
 * Log a prompt injection detection event, throttled to once per hostname per minute.
 * Logs only the hostname and event class — never the matched phrase content,
 * which could itself contain injection payloads.
 *
 * @param hostname - Target hostname where the pattern was detected
 */
declare function logInjectionDetected(hostname: string): void;
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
declare function sanitizeAndDetect(text: string, label: string): string;

export { type CreateHttpOnlyUrlSchemaOptions, type DefendTextOptions, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH, applySpotlighting, createHttpOnlyUrlSchema, defendText, detectInjectionPattern, logInjectionDetected, safeHostname, sanitizeAndDetect, sanitizeDescription, sanitizeResponse };
