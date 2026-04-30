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
 * Observability-only: never suppresses or modifies the content.
 *
 * Call this on sanitized content so that invisible-char-split phrases
 * (e.g., "Ig​nore" → "Ignore" after sanitizeResponse) are detectable.
 *
 * @param input - Content to scan (already sanitized)
 * @returns true if any injection pattern matched
 */
export function detectInjectionPattern(input: string): boolean {
    return INJECTION_PATTERNS.test(input);
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
 * @param content - Response content to wrap
 * @param requestId - Unique identifier for this response (caller should pass randomUUID())
 * @returns Content wrapped in opaque sentinel delimiters
 */
export function applySpotlighting(content: string, requestId: string): string {
    const begin = `---EXTERNAL-CONTENT-BEGIN-${requestId}---`;
    const end = `---EXTERNAL-CONTENT-END-${requestId}---`;
    return `${begin}\n${content}\n${end}`;
}
