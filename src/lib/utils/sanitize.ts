// src/lib/utils/sanitize.ts
// Response sanitization utilities for prompt injection defense

import { FIXED_POINT_MAX_ITERATIONS } from "../config/limits.js";
import {
    INJECTION_PHRASE_GAP,
    UNICODE_ATTACK_RANGES,
    WHITESPACE_PADDING_CLASS,
    WHITESPACE_PADDING_CODEPOINTS,
} from "./unicode-attack-ranges.js";

/** Pre-computed Set of single whitespace-padding codepoints for O(1) lookup. */
const WS_PADDING_DISCRETE_SET: ReadonlySet<number> = new Set<number>(
    WHITESPACE_PADDING_CODEPOINTS.discrete
);

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
//
// **Newline rule includes single inline-whitespace interrupters.** A naive
// `\n{20,}` rule is defeated by `(\n × 19 + ws + \n × 19)` payloads where
// each individual newline run is below threshold but the concatenated
// whitespace surface is enormous. The pattern `(?:\n[ \t\xa0]?){20,}`
// accepts at most one ASCII space, tab, or NBSP between consecutive
// newlines so an interspersed inline-whitespace char doesn't reset the
// run. Non-whitespace interrupters (e.g. a literal `.` between
// newline groups) are NOT covered — pattern-matching detection in
// Step 2 still fires on the surrounding payload bytes and the LLM-
// visible structural change from `.\n.\n.\n...` is its own giveaway;
// catching that class would require a counting/density rule beyond
// what a single regex express cleanly.
const WHITESPACE_PADDING_PATTERN =
    `[${WHITESPACE_PADDING_CLASS}]{50,}|(?:\\n[ \\t\\xa0]?){20,}`;

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
//
// **Bounded-wildcard sizing.** Multi-keyword phrase
// matchers use the shared `INJECTION_PHRASE_GAP` fragment (currently
// `[\s\S]{0,80}`). 80 chars covers all observed gap-padding bypass attempts
// in the wild (`ignore<N spaces>previous instructions` and similar) while
// bounding the regex engine's backtracking work. Single source of truth
// lives in `unicode-attack-ranges.ts → INJECTION_PHRASE_GAP_MAX`; tweak
// there to widen/tighten every matcher together. The upper-bound is
// regression-locked in `sanitize.test.ts` via the 200-char-gap negative
// case and the wall-clock ReDoS budget.
//
// Single-keyword and structural-token patterns retain their existing
// shapes — only the multi-keyword phrase matchers
// (ignore/disregard/forget/override/do-not-follow/pass-contents/
// exfiltrate-creds) consume the shared fragment.
const INJECTION_PATTERNS = new RegExp(
    [
        // Explicit instruction override
        `ignore${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|system)${INJECTION_PHRASE_GAP}instructions?`,
        `disregard${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|system)${INJECTION_PHRASE_GAP}(instructions?|directives?|rules?)`,
        `forget${INJECTION_PHRASE_GAP}(previous|prior|all|your|above|everything|instructions?)`,
        `override${INJECTION_PHRASE_GAP}(your|the|all|previous)${INJECTION_PHRASE_GAP}(instructions?|settings?|behavior|config|directives?|rules?)`,
        // Synonym families for the explicit-override class
        // — paraphrases that the four canonical verbs above miss
        // ("stop following your instructions", "cease compliance with the
        // rules", "bypass your safety filters"). Each family carries at
        // least one regression test in `sanitize.test.ts`.
        //
        // **Known false-positive class** — `stop\s+applying` over-triggers
        // on legitimate ops/safety phrasing ("stop applying this patch",
        // "stop applying the brakes"). Detection is observability-only so
        // the cost is log noise, not blocked content. Locked by the
        // `documented FP class` test in
        // `sanitize.test.ts` so a future narrowing PR (e.g. requiring an
        // instruction-class object word in the same shape
        // `bypass\s+(your|all|the)\s+(...)` uses) updates implementation
        // and tests together.
        "stop\\s+(following|obeying|applying)",
        "cease\\s+(compliance|following|obeying)",
        "bypass\\s+(your|all|the)\\s+(instructions?|filters?|safety)",
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
        `do\\s+not\\s+(follow|apply|use|obey|comply)${INJECTION_PHRASE_GAP}instructions?`,
        // Data exfiltration — file system triggers
        "read\\s+~\\/\\.(ssh|cursor|env|zshrc|bashrc|config|npmrc|gitconfig)",
        `pass${INJECTION_PHRASE_GAP}(its|the)\\s+contents?\\s+as`,
        "exfiltrate",
        `(extract|exfiltrate|leak|transmit|send\\s+me)${INJECTION_PHRASE_GAP}(passwords?|credentials?|secrets?|tokens?|api[\\s\\S]{0,5}keys?)`,
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
 * @returns Sanitized string with attack characters replaced by space, then trimmed
 */
export function sanitizeDescription(input: string | null | undefined): string {
    if (input == null) return "";
    return input.replace(DESC_CONTROL_CHARS, " ").trim();
}

/**
 * Idempotence cap for {@link sanitizeResponse}. Imports the shared
 * `FIXED_POINT_MAX_ITERATIONS` from `config/limits.ts` so this loop and
 * the parallel script/style-strip loop in
 * `response/strip-blocks.ts → stripBlocksFixedPoint` cannot drift
 * independently. See the JSDoc on `FIXED_POINT_MAX_ITERATIONS` for the
 * shared rationale.
 */
const SANITIZE_FIXED_POINT_MAX_ITERATIONS = FIXED_POINT_MAX_ITERATIONS;

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
export function sanitizeResponse(input: string | null | undefined): string {
    if (input == null) return "";
    let curr = input;
    for (let i = 0; i < SANITIZE_FIXED_POINT_MAX_ITERATIONS; i++) {
        const next = curr.replace(RESPONSE_SANITIZE_PATTERN, (match) => {
            // Newline-padding attack: collapse 20+ `\n` to one (preserves rough
            // document structure for prettified JSON / multi-line text).
            if (match.charCodeAt(0) === 0x0a) return "\n";
            // Visual-space-padding attack: collapse 50+ space-class chars to one
            // ASCII space (JSON-safe). ASCII space is U+0020; anything else in
            // the whitespace-padding class normalises to a single ASCII space.
            if (isWhitespacePaddingMatch(match)) return " ";
            // Unicode control/invisible char — remove entirely.
            return "";
        });
        if (next === curr) return next;
        curr = next;
    }
    return curr;
}

/**
 * Internal: classify a `RESPONSE_SANITIZE_PATTERN` match as whitespace-padding
 * (vs Unicode-invisible attack).
 *
 * Membership is derived from {@link WHITESPACE_PADDING_CODEPOINTS} so the
 * classifier and the regex source-of-truth (`WHITESPACE_PADDING_CLASS`)
 * cannot silently desync. Adding a new whitespace class is one edit there.
 */
function isWhitespacePaddingMatch(match: string): boolean {
    const cp = match.codePointAt(0);
    if (cp === undefined) return false;
    if (WS_PADDING_DISCRETE_SET.has(cp)) return true;
    return WHITESPACE_PADDING_CODEPOINTS.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
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
 * public barrel) over hand-wiring the primitives — it locks the project's
 * canonical detect-then-sanitise ordering: detection runs on the **original**
 * text (so signals the sanitiser would later strip — e.g. Unicode-attack
 * payloads such as bidi overrides or zero-width characters — still fire the
 * per-host log) and sanitisation produces the bytes the LLM actually sees
 * (see `detection-logger.ts → sanitizeAndDetect`). Calling this
 * matcher directly on **already-sanitised** text trades that signal-
 * preservation for invisible-char-split coverage instead: phrases like
 * "Ig​nore" (zero-width space splitting `ignore`) collapse to `Ignore`
 * after sanitisation and become detectable. Both call shapes are
 * legitimate; pick based on which class you care about preserving.
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
 *   are valid; pick based on which class you care about. See
 *   `detection-logger.ts → sanitizeAndDetect` for the ordering rationale.
 * @returns true if any injection pattern matched
 */
export function detectInjectionPattern(input: string): boolean {
    // NFKC normalisation closes the homoglyph / width-variant bypass class
    // (full-width Latin, compatibility ligatures, ASCII-mappable compat forms)
    // for the detection-only path. The normalised string is local to this
    // function — callers continue to flow the original `input` downstream.
    return INJECTION_PATTERNS.test(input.normalize("NFKC"));
}

/**
 * Sentinel prefix shared by `applySpotlighting` and the idempotence guard
 * in `response/post-processor.ts`. Centralised here so the wrap-detection
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
 * because the attacker controls the bytes. `response/post-processor.ts →
 * createWrapper` avoids that class entirely for whole-result re-wrapping by
 * tagging the `CallToolResult` object with a module-private Symbol instead;
 * this content-based check remains the guard for `applySpotlighting` itself,
 * where no such object-level tag is available.
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
