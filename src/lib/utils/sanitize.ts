// src/lib/utils/sanitize.ts
// Response sanitization utilities for prompt injection defense

/**
 * Maximum length for custom tool descriptions.
 * Clients (OpenAI-compatible) truncate descriptions beyond ~1024 chars;
 * staying under 1000 provides a safe margin.
 */
export const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;

// Single source of truth for the Unicode-attack character class used by both
// the description and response sanitizers. Covers: C0/C1 control chars
// (excluding \t \n \r), soft hyphen, zero-width chars, bidi embedding /
// override / isolation, word-joiner family, BOM, variation selectors, Tags
// block, U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR (ECMAScript
// line terminators).
//
// Stored as a string fragment (not a RegExp) so each consumer builds its own
// RegExp instance — RegExp objects with the g flag are stateful and must not
// be shared across call sites.
const UNICODE_ATTACK_RANGES =
    "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}";

// NOT exported — g+u flags make regexes stateful; external .test() corrupts lastIndex.
const DESC_CONTROL_CHARS = new RegExp(`[${UNICODE_ATTACK_RANGES}]+`, "gu");

// NOT exported — same stateful reasoning.
// Single-pass: same Unicode ranges as DESC_CONTROL_CHARS PLUS 50+ consecutive spaces.
const RESPONSE_SANITIZE_PATTERN = new RegExp(`[${UNICODE_ATTACK_RANGES}]+| {50,}`, "gu");

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
 * 1. Unicode attack vectors (bidi overrides, zero-width chars, Tags block, etc.) → removed
 * 2. Whitespace-padding runs (50+ consecutive spaces) → collapsed to a single space
 *
 * Normal whitespace (\t, \n, \r) is preserved to maintain response formatting.
 *
 * Whitespace runs collapse to a single space (rather than a marker like
 * "[WHITESPACE REMOVED]") because callers may JSON.parse the sanitized output
 * (see response/processor.ts → applyJqFilterToParsed). Inserting a non-whitespace
 * marker into the middle of a JSON document — between tokens or inside a deeply
 * pretty-printed value — would break the parse. A single space preserves
 * JSON validity while still neutralising the padding attack (the hidden tail
 * is no longer hidden behind a wall of whitespace), and detectInjectionPattern
 * still fires on the collapsed content for observability.
 *
 * @param input - Response content to sanitize (null/undefined returns "")
 * @returns Sanitized content
 */
export function sanitizeResponse(input: string | null | undefined): string {
    if (input == null) return "";
    return input.replace(RESPONSE_SANITIZE_PATTERN, (match) => {
        // Whitespace-padding attack: collapse 50+ spaces to one (JSON-safe).
        if (match[0] === " ") return " ";
        // Unicode control/invisible char — remove entirely
        return "";
    });
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
 * UUID-ish shape: 32–36 hex chars with optional dashes. Strict enough to
 * reject obvious mistakes (`"req"`, `"session-1"`, `Date.now().toString()`,
 * `"my-app"`) without forcing the exact RFC 4122 layout — the security
 * property is "unguessable per request", which any high-entropy hex token
 * satisfies. The wrapper passes `randomUUID()`; external callers may pass
 * their own UUID v4/v7 token.
 */
const SPOTLIGHT_REQUEST_ID_PATTERN = /^[0-9a-f-]{32,36}$/i;

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
 * **Idempotence:** if `content` already begins with the spotlight sentinel
 * prefix, the function returns it unchanged. The `extensible/tool-wrapper`
 * also short-circuits when the inner result is already wrapped — both layers
 * defend against double-wrapping (which would otherwise nest two different
 * UUID sentinels and confuse the LLM about where the trust boundary lies).
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
    // produce nested sentinels with two different UUIDs. Idempotence runs first because
    // the requestId is unused on this path — validating it would only block legitimate
    // double-wrap attempts that we already short-circuit.
    if (content.startsWith(SPOTLIGHT_SENTINEL_PREFIX)) {
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
