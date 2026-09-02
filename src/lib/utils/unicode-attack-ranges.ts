// src/lib/utils/unicode-attack-ranges.ts
//
// **@internal — package-internal only.** Not re-exported from the package
// barrel (`src/lib.ts` / `src/lib/utils/index.ts`). The only legitimate
// consumer is `src/lib/utils/sanitize.ts`, which builds RegExp instances
// from these character-class fragments. Custom-tool authors and external
// callers should compose with the public `sanitizeResponse` /
// `sanitizeAndDetect` primitives instead — those are the stable contract.
//
// Single source of truth for two adjacent concerns, both consumed only by
// `src/lib/utils/sanitize.ts`:
//
//   1. **Unicode codepoint ranges** used by the description and response
//      sanitisers (`UNICODE_ATTACK_RANGES`, `WHITESPACE_PADDING_*`).
//   2. **Injection-pattern detection tunables**
//      (`INJECTION_PHRASE_GAP_MAX`, `INJECTION_PHRASE_GAP`) used to size the
//      bounded wildcards inside `INJECTION_PATTERNS`. Co-located here for the
//      same reason the Unicode fragments are: a single place to tune
//      sanitiser/detector behaviour with a single import path. If a future
//      iteration grows the detection-tunable set materially, lifting it to a
//      dedicated `src/lib/config/detection.ts` is the natural next step (per
//      the repo `config/` convention used by `limits.ts`).
//
// Stored as named string fragments / number constants so each consumer
// builds its own RegExp instance — RegExp objects with the `g` flag are
// stateful and must not be shared across call sites.
//
// Each block is a `\u…` / `\u{…}` character-class fragment (no surrounding
// brackets) suitable for splicing into `[…]` inside a `new RegExp(..., "gu")`
// constructor. Append-only when adding new attack classes — never remove
// without a migration plan.
//
// References:
//   - Unicode 15.0 (https://www.unicode.org/versions/Unicode15.0.0/)
//   - "Sneaky Bits" prompt-injection research (2025–2026) — VS Supplement
//     payload encoding (U+E0100–U+E01EF)
//   - 2026 prompt-injection reports — Braille blank, Arabic letter mark,
//     Hangul fillers as zero-width hiding characters

/** C0 control chars EXCEPT `\t` (U+0009), `\n` (U+000A), `\r` (U+000D). */
const C0_CONTROLS = "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F";

/** C1 control chars (U+007F DEL through U+009F APPLICATION PROGRAM COMMAND). */
const C1_CONTROLS = "\\u007F-\\u009F";

/** U+00AD SOFT HYPHEN — invisible word-break opportunity. */
const SOFT_HYPHEN = "\\u00AD";

/**
 * U+061C ARABIC LETTER MARK — bidi control routinely missed by sanitiser
 * lists. Same hiding properties as U+202E.
 */
const ARABIC_LETTER_MARK = "\\u061C";

/**
 * U+115F HANGUL CHOSEONG FILLER and U+1160 HANGUL JUNGSEONG FILLER — render
 * as zero-width in many fonts; documented hiding chars in 2025–2026
 * prompt-injection reports.
 */
const HANGUL_FILLERS = "\\u115F\\u1160";

/**
 * U+180B–U+180D MONGOLIAN FREE VARIATION SELECTORs ONE-TO-THREE (used in 2025
 * "Sneaky Bits" research alongside the U+FE00–U+FE0F Variation Selectors)
 * AND U+180E MONGOLIAN VOWEL SEPARATOR.
 */
const MONGOLIAN_INVISIBLES = "\\u180B-\\u180E";

/** U+200B–U+200F: zero-width family + LRM/RLM bidi marks. */
const ZERO_WIDTH_AND_DIRECTIONAL_MARKS = "\\u200B-\\u200F";

/** U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR — ECMAScript line terminators. */
const LINE_PARAGRAPH_SEPARATORS = "\\u2028\\u2029";

/** U+202A–U+202E bidi embedding / override / pop-directional. */
const BIDI_EMBEDDING_OVERRIDE = "\\u202A-\\u202E";

/**
 * U+2060–U+2064 word joiner family (WORD JOINER, FUNCTION APPLICATION,
 * INVISIBLE TIMES, INVISIBLE SEPARATOR, INVISIBLE PLUS).
 */
const WORD_JOINER_FAMILY = "\\u2060-\\u2064";

/** U+2066–U+2069 bidi isolation marks (LRI, RLI, FSI, PDI). */
const BIDI_ISOLATES = "\\u2066-\\u2069";

/**
 * U+2800 BRAILLE PATTERN BLANK — renders as space in Braille fonts but is a
 * single Braille codepoint, not whitespace. Tokenisation is inconsistent
 * across MCP clients.
 */
const BRAILLE_PATTERN_BLANK = "\\u2800";

/**
 * U+3164 HANGUL FILLER — zero-width-renderable filler in many fonts; classic
 * homoglyph hiding char in 2026 reports.
 */
const HANGUL_FILLER_3164 = "\\u3164";

/** U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM. */
const BOM = "\\uFEFF";

/** U+FE00–U+FE0F Variation Selectors One-to-Sixteen (basic plane). */
const VARIATION_SELECTORS_BASIC = "\\uFE00-\\uFE0F";

/**
 * U+E0000–U+E007F TAGS block (deprecated tag characters; smuggled metadata
 * carrier in 2024–2025 reports).
 */
const TAGS_BLOCK = "\\u{E0000}-\\u{E007F}";

/**
 * U+E0100–U+E01EF VARIATION SELECTORs SEVENTEEN-TO-256 (Variation Selectors
 * Supplement). Distinct from the lower TAGS block — the original sanitiser
 * range only covered U+E0000–U+E007F, leaving "Sneaky Bits" payloads encoded
 * in the supplement intact.
 */
const VARIATION_SELECTORS_SUPPLEMENT = "\\u{E0100}-\\u{E01EF}";

/**
 * Full attack-range fragment used inside the sanitiser character class.
 * Composed in attack-class order (controls → marks → bidi → invisibles →
 * supplementary planes) so the source reads as a taxonomy, not a soup.
 *
 * **Append-only.** Every entry has a regression test — removing any one of
 * these without a deliberate migration breaks the corresponding bypass guard.
 */
export const UNICODE_ATTACK_RANGES =
    C0_CONTROLS +
    C1_CONTROLS +
    SOFT_HYPHEN +
    ARABIC_LETTER_MARK +
    HANGUL_FILLERS +
    MONGOLIAN_INVISIBLES +
    ZERO_WIDTH_AND_DIRECTIONAL_MARKS +
    LINE_PARAGRAPH_SEPARATORS +
    BIDI_EMBEDDING_OVERRIDE +
    WORD_JOINER_FAMILY +
    BIDI_ISOLATES +
    BRAILLE_PATTERN_BLANK +
    HANGUL_FILLER_3164 +
    BOM +
    VARIATION_SELECTORS_BASIC +
    TAGS_BLOCK +
    VARIATION_SELECTORS_SUPPLEMENT;

/**
 * **@internal** Whitespace-padding codepoints, structured for re-use by both
 * the regex character class and the runtime classifier in
 * `sanitize.ts → isWhitespacePaddingMatch`. Single source of truth — adding
 * a new whitespace class is one edit here, not two.
 *
 *   - `discrete`: codepoints with no neighbouring class-members.
 *   - `ranges`: contiguous ranges as `[lo, hi]` inclusive tuples.
 *
 * **Type signatures use `readonly number[]` rather than `as const` literal
 * unions** so consumers can call `.includes(cp)` / `.has(cp)` against
 * runtime `cp: number` values without TS narrowing the parameter to a
 * literal union and erroring. The `as const` form was a footgun: a future
 * maintainer reaching for `discrete.includes(cp)` got
 * `error TS2345: Argument of type 'number' is not assignable to parameter
 * of type '32 | 9 | 160 | 8239 | 8287 | 12288'`. Widened types preserve
 * the source-of-truth property (one edit per new codepoint) without the
 * literal-union friction.
 */
export const WHITESPACE_PADDING_CODEPOINTS: {
    readonly discrete: readonly number[];
    readonly ranges: readonly (readonly [number, number])[];
} = {
    discrete: [
        0x0020, // SPACE
        0x0009, // TAB
        0x00a0, // NO-BREAK SPACE
        0x202f, // NARROW NO-BREAK SPACE
        0x205f, // MEDIUM MATHEMATICAL SPACE
        0x3000, // IDEOGRAPHIC SPACE
    ],
    ranges: [
        [0x2000, 0x200a], // EN/EM-space family
    ],
};

/**
 * **@internal** Format a codepoint as a `\u{…}` regex-class atom, picking the
 * BMP-friendly form for codepoints ≤ 0xFFFF (which V8 accepts in both `u`
 * and non-`u` modes) and the wide form otherwise.
 */
const fmt = (cp: number): string =>
    cp <= 0xffff
        ? `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`
        : `\\u{${cp.toString(16).toUpperCase()}}`;

/**
 * **@internal** Whitespace-padding character class — used for the 50+-run
 * collapse rule in `sanitizeResponse`. Derived from {@link
 * WHITESPACE_PADDING_CODEPOINTS} so the runtime classifier can never
 * silently desync from the regex source-of-truth. Newlines are handled by a
 * separate run rule (`\n{20,}`) because their threshold is different.
 */
export const WHITESPACE_PADDING_CLASS =
    WHITESPACE_PADDING_CODEPOINTS.discrete.map(fmt).join("") +
    WHITESPACE_PADDING_CODEPOINTS.ranges
        .map(([lo, hi]) => `${fmt(lo)}-${fmt(hi)}`)
        .join("");

/**
 * **@internal** Maximum gap (in characters, including newlines) permitted
 * between adjacent keywords inside a multi-keyword `INJECTION_PATTERNS`
 * matcher. Sized to cover all observed gap-padding bypass attempts in the
 * wild (`ignore<N spaces>previous instructions` and similar) while still
 * bounding the regex engine's backtracking work. See the JSDoc on
 * `detectInjectionPattern` and the comment block above `INJECTION_PATTERNS`
 * in `sanitize.ts` for the sizing rationale and the leetspeak / UTS #39
 * deferral notes.
 *
 * Single source of truth: change here and every multi-keyword matcher
 * widens / tightens together. `INJECTION_PHRASE_GAP` below is the
 * regex-source fragment derived from this number.
 */
export const INJECTION_PHRASE_GAP_MAX = 80;

/**
 * **@internal** Bounded-wildcard regex fragment used between adjacent
 * keywords inside `INJECTION_PATTERNS` multi-keyword matchers. `[\s\S]`
 * (rather than `.`) so the bound matches across newlines, catching
 * multi-line injection phrases like
 * `Ignore\nprevious\ninstructions`. Derived from
 * {@link INJECTION_PHRASE_GAP_MAX} so a single edit propagates to every
 * matcher and the upper-bound regression tests.
 */
export const INJECTION_PHRASE_GAP = `[\\s\\S]{0,${INJECTION_PHRASE_GAP_MAX}}`;
