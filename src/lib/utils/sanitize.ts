// src/lib/utils/sanitize.ts
// Response sanitization utilities for prompt injection defense

import { UNICODE_ATTACK_RANGES, WHITESPACE_PADDING_CLASS } from "./unicode-attack-ranges.js";

/**
 * Maximum length for custom tool descriptions.
 * Clients (OpenAI-compatible) truncate descriptions beyond ~1024 chars;
 * staying under 1000 provides a safe margin.
 */
export const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;

// NOT exported — g+u flags make regexes stateful; external .test() corrupts lastIndex.
const DESC_CONTROL_CHARS = new RegExp(`[${UNICODE_ATTACK_RANGES}]+`, "gu");

// Whitespace-padding attacks: collapse runs of any visual-space character to
// one space, and runs of newlines to one newline. Thresholds are heuristic —
// 50 chars (or 20 newlines) is the smallest run unlikely in legitimate
// formatting. 49-char runs are functionally equivalent for hiding content;
// this is an accepted tolerance, not a bug — lowering the threshold raises
// false-positive risk on legitimate code blocks and ASCII art.
const WHITESPACE_PADDING_PATTERN = `[${WHITESPACE_PADDING_CLASS}]{50,}|\\n{20,}`;

// NOT exported — same stateful reasoning.
// Single-pass: Unicode attack chars + 50+-run whitespace padding (across the
// extended visual-space class) + 20+-run newline collapse.
const RESPONSE_SANITIZE_PATTERN = new RegExp(
    `[${UNICODE_ATTACK_RANGES}]+|${WHITESPACE_PADDING_PATTERN}`,
    "gu"
);

// No g flag — safe for repeated .test() without lastIndex accumulation.
// [\s\S]{0,n} instead of .{0,n} so bounded wildcards match across newlines,
// catching multi-line injection phrases like "Ignore\nprevious\ninstructions".
const INJECTION_PATTERNS = new RegExp(
    [
        // Explicit instruction override
        "ignore[\\s\\S]{0,20}(previous|prior|all|your|above|system)[\\s\\S]{0,20}instructions?",
        "disregard[\\s\\S]{0,20}(previous|prior|all|your|above|system)[\\s\\S]{0,20}(instructions?|directives?|rules?)",
        "forget[\\s\\S]{0,20}(previous|prior|all|your|above|everything|instructions?)",
        "override[\\s\\S]{0,20}(your|the|all|previous)[\\s\\S]{0,20}(instructions?|settings?|behavior|config|directives?|rules?)",
        // Persona takeover
        "you\\s+are\\s+now\\s+",
        "act\\s+as\\s+",
        "assume\\s+the\\s+role\\s+of",
        "pretend\\s+(you\\s+are|to\\s+be)",
        "roleplay\\s+as",
        "\\bDAN\\b",
        "jailbreak",
        // Privilege escalation / structural override tokens
        "\\[ADMIN[\\s_-]*OVERRIDE\\]",
        "<\\s*admin\\s*>",
        "<\\s*SYSTEM\\s*>",
        "<\\s*IMPORTANT\\s*>",
        "\\[INST\\]",
        // System/prompt manipulation
        "system\\s+prompt",
        "new\\s+(primary\\s+)?instructions?\\s*(are|:|follow)",
        "your\\s+new\\s+(primary\\s+|main\\s+)?objective",
        "do\\s+not\\s+(follow|apply|use|obey|comply)[\\s\\S]{0,20}instructions?",
        // Data exfiltration — file system triggers
        "read\\s+~\\/\\.(ssh|cursor|env|zshrc|bashrc|config|npmrc|gitconfig)",
        "pass[\\s\\S]{0,20}(its|the)\\s+contents?\\s+as",
        "exfiltrate",
        "(extract|exfiltrate|leak|transmit|send\\s+me)[\\s\\S]{0,30}(passwords?|credentials?|secrets?|tokens?|api[\\s\\S]{0,5}keys?)",
    ].join("|"),
    "i"
);

/**
 * Sanitize a string for use in tool metadata or prompt templates.
 * Strips dangerous Unicode attack vectors (bidi overrides, zero-width chars, soft hyphen,
 * variation selectors, Tags block) while preserving normal whitespace (\t, \n, \r, space)
 * and all printable characters.
 *
 * @param input - String to sanitize (null/undefined returns "")
 * @returns Sanitized string with attack characters replaced by space
 */
export function sanitizeDescription(input: string | null | undefined): string {
    if (input == null) return "";
    return input.replace(DESC_CONTROL_CHARS, " ").trim();
}

/**
 * Sanitize HTTP response content before returning to LLM.
 *
 * Single-pass sanitization:
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
export function sanitizeResponse(input: string | null | undefined): string {
    if (input == null) return "";
    return input.replace(RESPONSE_SANITIZE_PATTERN, (match) => {
        // Newline-padding attack: collapse 20+ `\n` to one (preserves rough
        // document structure for prettified JSON / multi-line text).
        if (match.charCodeAt(0) === 0x0a) return "\n";
        // Visual-space-padding attack: collapse 50+ space-class chars to one
        // ASCII space (JSON-safe). ASCII space is U+0020; anything else in the
        // whitespace-padding class normalises to a single ASCII space.
        if (isWhitespacePaddingMatch(match)) return " ";
        // Unicode control/invisible char — remove entirely.
        return "";
    });
}

/**
 * Internal: classify a `RESPONSE_SANITIZE_PATTERN` match as whitespace-padding
 * (vs Unicode-invisible attack). Whitespace runs share a known starter set
 * (ASCII space, tab, NBSP, en/em-spaces, NARROW NO-BREAK, MEDIUM MATHEMATICAL,
 * IDEOGRAPHIC). Anything else is a Unicode invisible and is removed entirely.
 */
function isWhitespacePaddingMatch(match: string): boolean {
    const cp = match.codePointAt(0);
    if (cp === undefined) return false;
    // U+0020 SPACE, U+0009 TAB, U+00A0 NBSP
    if (cp === 0x20 || cp === 0x09 || cp === 0xa0) return true;
    // U+2000–U+200A en/em-space family
    if (cp >= 0x2000 && cp <= 0x200a) return true;
    // U+202F NARROW NO-BREAK SPACE, U+205F MEDIUM MATHEMATICAL SPACE
    if (cp === 0x202f || cp === 0x205f) return true;
    // U+3000 IDEOGRAPHIC SPACE
    if (cp === 0x3000) return true;
    return false;
}

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
 * public barrel) over hand-wiring the primitives — it locks the
 * sanitize → detect → log ordering invariant. Calling this matcher on raw
 * (un-sanitized) text means invisible-char-split phrases like "Ig​nore" will
 * not match, silently degrading detection coverage.
 *
 * **Stability contract:** the *intent* — return `true` when the (already
 * sanitised) content matches a known prompt-injection signal — is stable. The
 * specific pattern set is **not** part of the public contract and will expand
 * over time as new attack phrasings emerge. Tests that assert on which strings
 * do or do not match should target known categories (e.g. instruction-override
 * phrases) rather than exact wording, and callers must continue to honour the
 * "observability only" rule regardless of which patterns are in play.
 *
 * @param input - Content to scan (must already be passed through `sanitizeResponse`)
 * @returns true if any injection pattern matched
 */
export function detectInjectionPattern(input: string): boolean {
    return INJECTION_PATTERNS.test(input);
}

/**
 * Sentinel prefix shared by `applySpotlighting` and the idempotence guard
 * in `extensible/tool-wrapper.ts`. Centralised here so the wrap-detection
 * regex stays in lock-step with the wrap-emission template.
 */
export const SPOTLIGHT_SENTINEL_PREFIX = "---EXTERNAL-CONTENT-BEGIN-";

/**
 * Strict UUID shapes accepted as a spotlight request ID:
 *   - **Compact 32-hex** (no dashes) — `randomUUID().replace(/-/g, "")`
 *   - **RFC 4122 8-4-4-4-12 layout** (with dashes) — direct `randomUUID()` output
 *
 * The earlier looser pattern `/^[0-9a-f-]{32,36}$/i` accepted strings made
 * entirely (or mostly) of dashes — e.g. 36 dashes — which produces a
 * predictable, low-entropy sentinel that an attacker can spoof in payload
 * content. The wrapper layer always passes `randomUUID()` so this only
 * affects custom-tool authors, but the explicit purpose of the validator is
 * to reject obvious low-entropy mistakes; a string of dashes is exactly that.
 */
const SPOTLIGHT_REQUEST_ID_PATTERN =
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Header-only matcher used by `isSpotlightEnvelope` to extract the embedded
 * UUID from a putative envelope without scanning the entire content. The
 * complete-envelope check (begin + matching end) is composed in
 * `isSpotlightEnvelope` rather than expressed as a single backreferenced
 * regex against `[\s\S]*` so we avoid catastrophic-backtracking shapes on
 * 10 MB inputs.
 */
const SPOTLIGHT_HEADER_PATTERN = /^---EXTERNAL-CONTENT-BEGIN-([0-9a-f-]{32,36})---\n/i;

/**
 * Returns `true` only if `text` is a *complete* spotlight envelope: it starts
 * with `---EXTERNAL-CONTENT-BEGIN-{uuid}---\n` AND ends with the matching
 * `\n---EXTERNAL-CONTENT-END-{same-uuid}---` sentinel, where `{uuid}` is a
 * strict UUID shape (per `SPOTLIGHT_REQUEST_ID_PATTERN`).
 *
 * **Why this is stricter than `startsWith(SPOTLIGHT_SENTINEL_PREFIX)`.** The
 * idempotence guard's purpose is "is this output of a previous
 * `applySpotlighting` call?" A prefix-only check answered "no" to that
 * question whenever the begin sentinel was prepended — including by an
 * attacker who controls the HTTP response body. By requiring the matching
 * end sentinel with the same UUID, the only way to produce a false-positive
 * is to forge a complete, well-formed envelope (raising bypass cost from
 * ~26 prepended bytes to ~120 bytes plus consistent UUID at both ends).
 *
 * Content-based idempotence is fundamentally vulnerable to attacker forgery
 * because the attacker controls the bytes; metadata-based tagging on the
 * `CallToolResult` object (Symbol-keyed property) is the proper fix and is
 * tracked in PR-6b of the hardening plan. This stricter check is the
 * defence-in-depth interim.
 *
 * Implementation is two `String.prototype` methods plus one bounded regex
 * scan against the header — no `[\s\S]*` backreferences over 10 MB inputs.
 *
 * @param text - Candidate text to test
 * @returns `true` iff `text` is a complete, well-formed spotlight envelope
 */
export function isSpotlightEnvelope(text: string): boolean {
    if (typeof text !== "string" || text.length < SPOTLIGHT_SENTINEL_PREFIX.length) return false;
    if (!text.startsWith(SPOTLIGHT_SENTINEL_PREFIX)) return false;
    const headerMatch = SPOTLIGHT_HEADER_PATTERN.exec(text);
    if (!headerMatch) return false;
    const uuid = headerMatch[1];
    if (!SPOTLIGHT_REQUEST_ID_PATTERN.test(uuid)) return false;
    const expectedEnd = `\n---EXTERNAL-CONTENT-END-${uuid}---`;
    return text.endsWith(expectedEnd);
}

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
export function applySpotlighting(content: string, requestId: string): string {
    // Idempotence: if the content is already wrapped (by an inner call to applySpotlighting,
    // or by a caller that pre-wrapped before the framework re-wraps), return unchanged.
    // Without this guard, enabling spotlighting on a tool that already spotlights would
    // produce nested sentinels with two different UUIDs.
    //
    // The check requires a *complete* envelope (begin + matching end + same UUID), not
    // just the begin prefix — a prefix-only check let an attacker who controls the HTTP
    // response body prepend the public sentinel prefix and bypass spotlighting entirely.
    // Idempotence runs first because the requestId is unused on this path — validating
    // it would only block legitimate double-wrap attempts that we already short-circuit.
    if (isSpotlightEnvelope(content)) {
        return content;
    }
    // Empty requestId would produce sentinels like "---EXTERNAL-CONTENT-BEGIN-----..."
    // that an attacker could spoof in payload content. The sentinel's security depends
    // on the requestId being unguessable per request — fail loudly rather than silently
    // emit a degraded boundary.
    if (!requestId) {
        throw new Error("applySpotlighting: requestId must be a non-empty string");
    }
    // Reject obvious low-entropy mistakes (e.g. "req", "session-1", Date.now()) at build/dev time.
    // The wrapper layer always passes randomUUID() so this only catches custom-tool author errors.
    if (!SPOTLIGHT_REQUEST_ID_PATTERN.test(requestId)) {
        throw new Error(
            "applySpotlighting: requestId must be a UUID-shaped string (32–36 hex chars; pass randomUUID())"
        );
    }
    const begin = `${SPOTLIGHT_SENTINEL_PREFIX}${requestId}---`;
    const end = `---EXTERNAL-CONTENT-END-${requestId}---`;
    return `${begin}\n${content}\n${end}`;
}
