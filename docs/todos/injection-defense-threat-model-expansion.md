# TODO: Expand prompt-injection defense threat-model coverage

## Problem

The current defense covers a known set of Unicode attack ranges, ASCII
whitespace padding (50+ spaces), and a fixed list of injection phrases.
Several documented bypasses remain:

### Sanitization gaps (`src/lib/utils/sanitize.ts`)

- **Whitespace-padding only collapses ASCII space.** Tabs (`\t`), NBSP
  (U+00A0), other Unicode whitespace, and newline runs (`\n` 50+) are
  preserved verbatim. An attacker can produce equivalent visual padding using
  any of these. Verified empirically: 50 tabs → 52-char output, no collapse.
- **49-space attacks slip through.** The 50-char threshold is by design; a
  49-space pad is functionally equivalent for hiding content. Either lower
  the threshold (~20) or document the off-by-one tolerance.
- **`UNICODE_ATTACK_RANGES` gaps.** Missing characters that render as
  invisible/zero-width in some fonts:
  - U+180E MONGOLIAN VOWEL SEPARATOR
  - U+115F / U+1160 (Hangul fillers)
  - U+3164 HANGUL FILLER

### Detection gaps (`src/lib/utils/sanitize.ts:34-67`)

- **Homoglyph bypass.** Cyrillic `іgnore` (U+0456) bypasses ASCII pattern.
- **Leetspeak bypass.** `1gnor3`, `j41lbreak` etc.
- **Gap-padding bypass.** `ignore<25 spaces>previous` exceeds the `{0,20}`
  bounded-wildcard cap.
- **Synonym bypass.** `stop following`, `cease compliance`, etc.

Recommend: NFKC normalisation before running `INJECTION_PATTERNS`, widen the
gap from `{0,20}` to `{0,80}`, add common synonym variants.

## Proposed Fix

Detection is observability-only (never suppresses content), so these are not
fail-open security holes — they are coverage improvements. Sanitization gaps
(whitespace runs) are more impactful because they affect what reaches the LLM.

Suggested ordering:

1. Widen `RESPONSE_SANITIZE_PATTERN` to include `[ \t ]{50,}` plus a
   separate `\n{20,}` guard.
2. Add the missing Unicode ranges to `UNICODE_ATTACK_RANGES`.
3. Lower or document the 50-space threshold.
4. Add NFKC normalisation step before `INJECTION_PATTERNS.test()`.
5. Widen detection-pattern bounded wildcards and add synonym coverage.

Each change should land with a bypass test demonstrating the previous behaviour.

## Location

- `src/lib/utils/sanitize.ts` — `UNICODE_ATTACK_RANGES`,
  `RESPONSE_SANITIZE_PATTERN`, `INJECTION_PATTERNS`,
  `detectInjectionPattern`

## Source

PR #21 comprehensive review (security-sentinel)
