// src/lib/utils/sanitize.ts
// Response sanitization utilities for prompt injection defense

/**
 * Maximum length for custom tool descriptions.
 * Clients (OpenAI-compatible) truncate descriptions beyond ~1024 chars;
 * staying under 1000 provides a safe margin.
 */
export const MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH = 1000;

// NOT exported — g+u flags make regexes stateful; external .test() corrupts lastIndex.
// Covers: C0/C1 control chars (excluding \t \n \r), soft hyphen, zero-width chars,
// bidi embedding/override/isolation, word-joiner family, BOM, variation selectors, Tags block.
const DESC_CONTROL_CHARS =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFE00-\uFE0F\u{E0000}-\u{E007F}]+/gu;

// NOT exported — same stateful reasoning.
// Single-pass: same Unicode ranges as DESC_CONTROL_CHARS PLUS 50+ consecutive spaces.
const RESPONSE_SANITIZE_PATTERN =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFE00-\uFE0F\u{E0000}-\u{E007F}]+| {50,}/gu;

// No g flag — safe for repeated .test() without lastIndex accumulation.
const INJECTION_PATTERNS = new RegExp(
    [
        // Explicit instruction override
        "ignore.{0,20}(previous|prior|all|your|above|system).{0,20}instructions?",
        "disregard.{0,20}(previous|prior|all|your|above|system).{0,20}(instructions?|directives?|rules?)",
        "forget.{0,20}(previous|prior|all|your|above|everything|instructions?)",
        "override.{0,20}(your|the|all|previous).{0,20}(instructions?|settings?|behavior|config|directives?|rules?)",
        // Persona takeover
        "you\\s+are\\s+now\\s+",
        "act\\s+as\\s+a\\s",
        "pretend\\s+(you\\s+are|to\\s+be)",
        "roleplay\\s+as",
        "\\bDAN\\b",
        "jailbreak",
        // System/prompt manipulation
        "system\\s+prompt",
        "new\\s+(primary\\s+)?instructions?\\s*(are|:|follow)",
        "your\\s+new\\s+(primary\\s+|main\\s+)?objective",
        "do\\s+not\\s+(follow|apply|use|obey|comply).{0,20}instructions?",
        // Data exfiltration
        "exfiltrate",
        "(extract|exfiltrate|leak|transmit|send\\s+me).{0,30}(passwords?|credentials?|secrets?|tokens?|api.{0,5}keys?)",
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
 * 2. Whitespace-padding runs (50+ consecutive spaces) → "[WHITESPACE REMOVED]" marker
 *
 * Normal whitespace (\t, \n, \r) is preserved to maintain response formatting.
 *
 * @param input - Response content to sanitize (null/undefined returns "")
 * @returns Sanitized content
 */
export function sanitizeResponse(input: string | null | undefined): string {
    if (input == null) return "";
    return input.replace(RESPONSE_SANITIZE_PATTERN, (match) => {
        // Whitespace-padding attack: match is 50+ spaces (first char is always a space)
        if (match[0] === " ") return "[WHITESPACE REMOVED]";
        // Unicode control/invisible char — remove entirely
        return "";
    });
}

/**
 * Scan content for prompt injection patterns.
 * Observability-only: never suppresses or modifies the content.
 *
 * Call this on sanitized content so that invisible-char-split phrases
 * (e.g., "Ig\u200Bnore" → "Ignore" after sanitizeResponse) are detectable.
 *
 * @param input - Content to scan (already sanitized)
 * @returns Sanitized matched phrase (newlines collapsed, max 200 chars) if detected, null otherwise
 */
export function detectInjectionPattern(input: string): string | null {
    const match = input.match(INJECTION_PATTERNS);
    if (!match) return null;
    // Return the phrase with newlines collapsed — never let raw injected content into logs
    return match[0].replace(/[\n\r]+/g, " ").slice(0, 200);
}

/**
 * Wrap response content with per-request trust-boundary sentinels (spotlighting).
 *
 * Uses the caller-provided requestId (a fresh UUID per request, never a module-level constant)
 * to make it harder for injected instructions to break out of the labeled data region.
 *
 * @param content - Response content to wrap
 * @param requestId - Unique identifier for this response (caller should pass randomUUID())
 * @returns Content wrapped in sentinel tags
 */
export function applySpotlighting(content: string, requestId: string): string {
    return `<response id="${requestId}">\n${content}\n</response>`;
}
