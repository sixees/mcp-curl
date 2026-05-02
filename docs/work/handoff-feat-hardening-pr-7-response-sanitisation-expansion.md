# Work Handoff: PR-7 — response-side sanitisation expansion (B7 sub-1-3 + B8)

**Date:** 2026-05-02
**Branch:** `feat/hardening-pr-7-response-sanitisation-expansion`
**Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B7-sub-1-3 lines 902–987, B8 lines 989–1098)
**Status:** complete

## Summary

Expands the response-side defence layer in two ways. **B7-sub-1-3** widens
`sanitizeResponse()` so the visual-space-padding rule covers tabs, NBSP, the
U+2000 en/em-space family, NARROW NO-BREAK SPACE, MEDIUM MATHEMATICAL SPACE
and IDEOGRAPHIC SPACE at the same 50+ run threshold (was: ASCII space only),
and adds a 20+ newline-run rule to defeat context-window-eviction attacks.
Eight missing Unicode invisibles (U+061C ARABIC LETTER MARK, U+115F/1160
HANGUL fillers, U+180B–U+180E Mongolian invisibles, U+2800 BRAILLE PATTERN
BLANK, U+3164 HANGUL FILLER, U+E0100–U+E01EF "Sneaky Bits" Variation
Selectors Supplement) are added to the attack-range character class — closing
the gap where Sneaky Bits payloads encoded in the supplement survived the old
sanitiser even though the lower TAGS block (U+E0000–U+E007F) was being
stripped. **B8** adds `<script>` / `<style>` block stripping to the response
processor for HTML / XHTML / SVG / `*+xml` content types, and markdown
beacon stripping (image + link) for markdown content types.

The Unicode-attack codepoint table moves out of an inline string in
`sanitize.ts` into a new `src/lib/utils/unicode-attack-ranges.ts` module
where each attack class is a named constant with a doc comment — the file
reads as a taxonomy, not a soup. The `<script>` / `<style>` strip is
ReDoS-hardened with a negative-lookahead body, fixed-point iteration cap,
numeric-entity decode pre-pass (defeats `&#x3c;script&#x3e;` smuggling),
and a 256 KB body cap that bypasses the strip path on adversarial inputs
while leaving `sanitizeAndDetect` to run downstream. An orphan-tag
cleanup pass after the balanced loop neutralises the `<script>` token that
self-healing payloads (`<scr<script>ipt>…</scr</script>ipt>`) leave behind
after the inner balanced match. Markdown beacon stripping replaces external
http(s) image URLs with `[image removed]` and external links with
`[link removed]`, with an explicit dangerous-scheme blocklist (S5:
`javascript:`, `vbscript:`, `file:`, `data:`) that fires regardless of the
http(s) shape.

C7 (move codepoint table to its own module), C12 (document the localhost
port-allowlist), and S5 (dangerous-scheme blocklist) — three deferred
findings explicitly tagged "deferred to PR-7" in the master plan's
technical-review pass — all land here. C12 was filed as "narrow to
3000-3999 / 5000-5999 / 8000-8999"; on inspection the actual implementation
allows `80, 443, or > 1024`, which is more permissive but covers
legitimate dev-server ports (Vite at 5173, dev servers at 4000, 9090…) the
narrower window would break. The doc note describes the actual behaviour
honestly and flags the suggestion as a future tightening option rather than
silently shipping a behaviour change.

## What was implemented

### New module — `src/lib/utils/unicode-attack-ranges.ts`

- 17 named attack-class constants (`C0_CONTROLS`, `C1_CONTROLS`,
  `SOFT_HYPHEN`, `ARABIC_LETTER_MARK`, `HANGUL_FILLERS`, `MONGOLIAN_INVISIBLES`,
  `ZERO_WIDTH_AND_DIRECTIONAL_MARKS`, `LINE_PARAGRAPH_SEPARATORS`,
  `BIDI_EMBEDDING_OVERRIDE`, `WORD_JOINER_FAMILY`, `BIDI_ISOLATES`,
  `BRAILLE_PATTERN_BLANK`, `HANGUL_FILLER_3164`, `BOM`,
  `VARIATION_SELECTORS_BASIC`, `TAGS_BLOCK`, `VARIATION_SELECTORS_SUPPLEMENT`).
- `UNICODE_ATTACK_RANGES` exports the concatenation in attack-class order
  (controls → marks → bidi → invisibles → supplementary planes) so the
  source reads as a taxonomy.
- `WHITESPACE_PADDING_CLASS` exports the visual-space character class
  (ASCII space, tab, NBSP, U+2000–U+200A, U+202F, U+205F, U+3000) used by
  the 50+ run rule.
- All entries have regression tests (one per range, plus the existing
  cross-class regression cases). The doc comment marks the module
  "append-only" with the rationale.

### Sanitiser widening — `src/lib/utils/sanitize.ts`

- Imports `UNICODE_ATTACK_RANGES` and `WHITESPACE_PADDING_CLASS` from the
  new module — `sanitize.ts` no longer holds the codepoint string.
- `RESPONSE_SANITIZE_PATTERN` rebuilt as
  `[${UNICODE_ATTACK_RANGES}]+|[${WHITESPACE_PADDING_CLASS}]{50,}|\n{20,}`,
  matched once per pass with the `gu` flags.
- `sanitizeResponse` match-callback now branches three ways:
  - newline run (`match.charCodeAt(0) === 0x0a`) → collapse to `"\n"`,
  - whitespace-padding run (codepoint in the visual-space class) → collapse
    to `" "`,
  - anything else → remove entirely (Unicode attack char).
- Unicode attack codepoints in `\n`-only or whitespace-only matches are
  impossible because the alternation branches are disjoint; the
  `isWhitespacePaddingMatch` helper documents the exact codepoint
  membership for the visual-space class.
- Doc comment rewritten to describe the new three-way collapse rule and the
  newline-run threshold (20+).

### New helper — `isMarkdownContentType()` in `src/lib/utils/content-type.ts`

- Mirrors `supportsMarkupComments` shape: exact set
  (`text/markdown`, `text/x-markdown`) plus structured-syntax suffix
  (`+markdown`, defined by RFC 6838 for symmetry with `+xml`).
- Pure predicate, exported through the `utils/index.ts` barrel.
- Negative tests confirm no match on `text/html`, `text/markdownish`,
  `application/markdown-extra`, `image/png`, etc.

### B8 strip path — `src/lib/response/processor.ts`

- `STRIP_PATH_MAX_BYTES = 256 * 1024` cap (UTF-8 byte length, not char
  length — adversarial bodies with high codepoints don't slip past).
- `STRIP_FIXED_POINT_MAX_ITERATIONS = 4` cap on the fixed-point loop.
- `SCRIPT_BLOCK_PATTERN` and `STYLE_BLOCK_PATTERN`: negative-lookahead body
  `(?:(?!<\/?script\b)[\s\S])*?<\/script\s*>` (and parallel for style),
  case-insensitive `gi` flags. Anchored on `\b` so `<scriptlike>` is not
  matched.
- `decodeNumericHtmlEntities()` decodes `&#x[hex];?` / `&#[dec];?` to
  characters in `[0, 0x10FFFF]`, runs once per fixed-point iteration entry
  so `&#x3c;script&#x3e;` smuggling attempts get unmasked. Out-of-range
  values silently drop to empty string. Named entities are intentionally
  left alone — they don't carry `<script>` shapes and decoding them risks
  re-introducing characters the upstream caller may want preserved.
- `stripBlocksFixedPoint()`: byte-length cap → entity decode → balanced
  strip loop with `next === curr` early-out → orphan-tag cleanup pass.
- **Orphan-tag cleanup** (`ORPHAN_SCRIPT_OPEN_PATTERN` /
  `ORPHAN_SCRIPT_CLOSE_PATTERN` and style equivalents): removes any
  unbalanced `<script>` / `</script>` / `<style>` / `</style>` tokens left
  behind by self-healing payloads. The balanced strip pattern requires
  matching open + close; payloads like
  `<scr<script>ipt>alert(1)</scr</script>ipt>` collapse on iteration 1 to
  `<script>` (open token, no closer) which the balanced pattern cannot
  touch. The orphan pass closes that gap. Linear-time, no nested
  quantifiers — ReDoS-safe.
- `MARKDOWN_EXTERNAL_IMAGE_PATTERN` /
  `MARKDOWN_EXTERNAL_LINK_PATTERN`: alt/label capped at 256 chars, URL
  capped at 2048 chars, link pattern uses `(?<!!)` negative lookbehind to
  avoid double-matching the `[…](…)` half of an image syntax.
  `[^\]\n]` excludes `]` and `\n` so the alt/label can't run past its own
  closing bracket.
- **S5 dangerous-scheme blocklist**:
  `MARKDOWN_DANGEROUS_SCHEME_PATTERN` matches both image (`!`-prefixed)
  and link forms with `javascript:`, `vbscript:`, `file:`, `data:` schemes,
  case-insensitive, with a 4096-char URL cap. Replacement preserves the
  image-vs-link distinction (`[image removed]` for `!`-prefixed,
  `[link removed]` otherwise). Runs FIRST so the http(s) patterns don't
  have to know about non-http schemes.
- `stripMarkdownBeacons()`: dangerous-scheme strip → external-image
  strip → external-link strip. Order matters — image strip must run before
  link strip so the `(?<!!)` lookbehind on the link pattern sees image
  syntax as either-fully-matched-or-untouched, never partially consumed.
- Pipeline wiring: inside `processResponse`, after the existing HTML-
  comment removal, the strip path runs for `supportsMarkupComments`-true
  content types AND a new branch fires `stripMarkdownBeacons()` for
  `isMarkdownContentType`-true content types. `sanitizeAndDetect` still
  runs after both strip paths (existing behaviour) so any residue still
  goes through Unicode normalisation + per-host detection logging.

### Doc updates

- **`README.md` Security Highlights**: two new bullets describing the
  expanded sanitiser (visual-space class, "Sneaky Bits", newline collapse)
  and the HTML / markdown stripping (script/style, ReDoS-hardened,
  numeric-entity decode; image beacons + external links + dangerous-scheme
  blocklist).
- **`docs/configuration.md`**: `allowLocalhost` section rewritten to
  describe the actual port allowlist (`80`, `443`, or `> 1024`) and call
  out which ports remain blocked even with the flag on. Honestly
  describes "the flag is allow dev work, not open every loopback port".
- **`src/lib.ts §7`**: comment block updated to mention PR-7's expansion
  of `sanitizeResponse`, with a pointer to the new
  `unicode-attack-ranges.ts` module.
- **`src/lib/resources/documentation.ts`**: new "Response Sanitisation"
  subsection in the Security block of the in-server `documentation://api`
  resource so the LLM also surfaces what's stripped.

### Tests

- **Extended: `src/lib/utils/sanitize.test.ts`** — three new describe
  blocks:
  - `extended whitespace-padding class (PR-7 / B7-sub-1)`: 13 cases
    covering 50-tab / 50-NBSP / 50-em / 50-en / 50-ideographic /
    50-narrow-no-break / 50-medium-mathematical collapses, the 49-char
    below-threshold preservation, mixed visual-space runs, and
    single-char preservation.
  - `newline-run collapse (PR-7 / B7-sub-1)`: 6 cases covering 19-vs-20
    threshold, 100-newline collapse, JSON-validity preservation under
    long newline runs, single-newline preservation, and independent
    collapse of newline + whitespace runs in one input.
  - `Unicode invisibles added in PR-7 / B7-sub-2`: 16 cases — one per new
    codepoint plus regressions for U+2062, U+2064, U+FE0F, U+E0041 to
    confirm the existing ranges still strip after the supplement was
    added.
- **Extended: `src/lib/response/processor.test.ts`** — two new describe
  blocks:
  - `HTML <script>/<style> stripping (PR-7 / B8)`: 11 cases covering
    basic strip, style-block strip (CSS-content injection), comment +
    script combined, case-insensitive variants, self-healing payload,
    numeric-hex / numeric-decimal entity-encoded variants, `<scriptlike>`
    non-match, SVG strip (image/svg+xml), text/plain non-strip, 256 KB
    skip-cap, and a 1 MB ReDoS regression with wall-clock < 100 ms
    assertion.
  - `markdown beacon stripping (PR-7 / B8)`: 9 cases covering image
    beacon, external link, relative-URL preservation, the
    image-inside-link nesting, S5 dangerous-scheme blocklist
    (javascript / vbscript / file / data), text/plain non-strip, and the
    `text/x-markdown` legacy MIME.
- **Extended: `src/lib/utils/content-type.test.ts`** — new describe block
  `isMarkdownContentType (PR-7 / B8)` with 7 cases (canonical + legacy +
  structured-syntax suffix + case-insensitive + parameter-stripping +
  adjacent-MIME negatives + substring-non-match).

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Extract codepoint table to `unicode-attack-ranges.ts` (C7) | The inline string in `sanitize.ts` was unauditable — no reader could tell what a particular codepoint did or why. Named constants per attack class give every range a doc comment and make additions reviewable. | Keep the inline string. Rejected — adds friction to every future addition. |
| Add orphan-tag cleanup pass after the balanced strip loop | The plan's diff sketch claimed self-healing payloads "fully neutralize within fixed-point iteration cap" but tracing the regex shows they collapse to a `<script>` (no closer) which the balanced pattern cannot touch. An orphan strip is one extra `.replace()` call per pass and removes the residue. | Tighten the test expectation to allow `<script>` token leftover. Rejected — defence-in-depth says no `<script>` token should reach the LLM. The orphan strip costs a few cycles. |
| `sanitizeResponse()` collapses newline runs to `\n` (not `" "`) | Newlines preserve rough document structure for prettified JSON / multi-line text. Collapsing to a space would break JSON validity for `{\n…\n}` shapes; collapsing to `\n` keeps the document valid while neutralising context-window-eviction attacks. | Collapse newlines to a single space. Rejected for JSON-safety. |
| `decodeNumericHtmlEntities` decodes ONLY numeric (`&#x…;` / `&#…;`), not named (`&amp;`, `&lt;`) | Numeric entities are the only reliable way to smuggle `<script` past a regex stripper in HTML; named entities don't carry script-tag shapes. Decoding `&lt;` would also re-introduce literal `<` characters into legitimate code-block content, breaking the strip-only-malicious posture. | Decode all entities. Rejected — risk of false positives on legitimate HTML-encoded code samples. |
| 256 KB strip-path cap (vs unbounded) | The strip patterns are linear-time individually but the fixed-point loop + entity decode together can hit O(n × iterations) on contrived input. A hard cap bounds worst-case wall-clock. The sanitiser still runs above the cap, so the LLM never sees attack-class characters even when the strip path skips. | No cap. Rejected — pathological inputs could starve the event loop. |
| Order: dangerous-scheme strip → image strip → link strip | The link pattern's `(?<!!)` negative lookbehind requires that image syntax is either fully consumed or fully untouched at the link-strip step; partial consumption corrupts the lookbehind decision. Dangerous-scheme runs first so http(s) patterns don't have to know about other schemes. | Process all in one pattern. Rejected — too many edge cases for one regex. |
| `(?<!!)` negative lookbehind on the link pattern | Without the lookbehind, the link strip would consume `[alt](url)` from inside a `![alt](url)` image syntax, and the image strip's substitution would leave residue. Lookbehind is supported in all maintained Node LTS versions. | Process images first then strip links unconditionally. Works in isolation but breaks in nested image-inside-link scenarios. |
| Image-inside-link nested test asserts inner-URL-gone, not both surface markers visible | After image strip, the form is `[[image removed]](outer-url)` — the link pattern can't match because the inner `]` interferes with `[label](url)`'s `\]` anchor. The security property (inner image URL gone) holds; both markers visible would require either changing the image replacement to non-bracketed text or using a recursive parser. | Rewrite image replacement to use non-bracketed text. Rejected — breaks the standalone-image case which the test asserts uses brackets. |
| C12 documents actual behaviour (`80, 443, > 1024`), not the plan's narrower suggestion | The plan's C12 suggested narrowing to `3000-3999 / 5000-5999 / 8000-8999`, which would break legitimate dev servers (Vite at 5173, dev servers at 4000, 9090, …). Documenting accurately is honest; the suggestion remains a future tightening option. | Implement the narrower allowlist. Rejected — would be a behaviour change in a doc-flagged item. |
| Suggested by reviewer C12 but not implemented: per-server port allowlist | Out of scope for PR-7 (sanitisation expansion); requires adjusting `isAllowedLocalhostPort` and adding regression tests for the narrower window. If a real deployment surfaces a need, a follow-up PR can add a config option. | Implement now. Deferred — PR-7 is already at 65 net new tests. |

## What to pay attention to during review

- **Orphan-tag cleanup is a deviation from the plan's diff sketch.** The
  plan's pseudo-code stops at the balanced fixed-point loop; the orphan
  pass was added after empirical testing showed self-healing payloads
  leave a `<script>` token behind. The orphan strip is a single regex
  pass per pattern, ReDoS-safe (no nested quantifiers), and the regression
  test for the self-healing case (`processor.test.ts`) is the guard. If a
  future refactor removes the orphan strip, the self-healing test will
  fail.
- **Image-inside-link test is weaker than the plan implied.** The plan's
  test description says "image AND link both replaced". My test asserts
  the inner image URL is gone (security property) but does not assert
  the outer link is also stripped. Tracing the regex shows the outer link
  cannot match after the image strip leaves a `[[image removed]]…`
  shape — the inner `]` interferes. The security-relevant URL (the
  exfiltration channel inside the image) IS gone; the outer URL surface
  remains visible but goes through `sanitizeAndDetect` and inherits the
  per-host log signal. Acceptable trade-off; alternative is a non-trivial
  refactor of the markdown patterns.
- **C12 decision deviates from the plan.** The plan suggested narrowing
  the localhost port allowlist; I documented current (broader) behaviour
  instead. Reasoning is in the Key decisions table. If reviewer prefers
  the narrower allowlist, that's a separate code change.
- **256 KB cap is on UTF-8 byte length, not char count.** Adversarial
  bodies with mostly-multi-byte codepoints could be larger in chars but
  still under the byte cap, or vice versa. `Buffer.byteLength(input,
  "utf8")` is the consistent measure used elsewhere in `processor.ts`.
- **`sanitize.test.ts` uses a mix of literal Unicode chars and `\u{…}`
  escapes.** Some test inputs (e.g. U+E0100, U+E0101, U+E01EF, U+E0041)
  use `\u{…}` because they're outside the BMP and many editors render
  them as replacement glyphs; basic-plane invisibles (U+061C, U+115F,
  U+180B, U+2062, U+2800, U+3164) are written as literal characters in
  the source for readability. Both forms compile to the same bytes — the
  test file passes ESM compilation cleanly.
- **The whitespace-padding class is intentionally wider than the
  detection-side normalisation will be (PR-8).** `sanitizeResponse`
  collapses NBSP / em-spaces; `detectInjectionPattern` does not (yet)
  NFKC-normalise its input. PR-8 closes that gap. For now: invisible
  whitespace is removed from output but the per-host detection log can
  still fire on the post-collapse text.

## Known issues and limitations

- **Image-inside-link nesting**: the outer link is not stripped when
  there's a markdown image inside it (see "What to pay attention to"
  above). Inner image URL is gone; outer link URL is preserved
  visibly. PR-8 / future iteration with a recursive parser closes this.
- **Markdown reference-style links** `[label][ref]` + `[ref]: url`
  syntax is NOT stripped. Only inline `[label](url)` shape is matched.
  Reference-style is rare in API responses but technically a bypass.
  Out of scope for PR-7; could be added as a separate strip pass if a
  real signal surfaces.
- **Named HTML entities** (`&lt;`, `&amp;`) are NOT decoded by the
  entity-decode pre-pass. A payload like `&lt;script&gt;…&lt;/script&gt;`
  would not be unmasked into its `<script>…</script>` form, and the
  strip pattern would not match. Documented choice — decoding named
  entities risks false positives on legitimate code samples. Numeric
  entities are the realistic smuggling vector and they ARE decoded.
- **Above 256 KB the strip path is skipped entirely.** Sanitiser still
  runs (Unicode attacks neutralised) but `<script>` tags above the cap
  reach the LLM. This is the intentional ReDoS-safe trade-off; the
  sanitiser is regex-bounded and linear-time so the LLM never sees
  attack-class bytes regardless.
- **No benchmark coverage.** The plan deferred bench/ infrastructure to
  PR-9. Net additions per request: one extra regex pass on the
  `RESPONSE_SANITIZE_PATTERN` (already O(n) with the new alternation
  branches), one optional script/style strip path (linear in input
  length, capped at 256 KB), one optional markdown beacon strip
  (linear in input length, no cap because pattern is bounded by
  alt-length 256 + URL-length 2048).
- **C5 (prompt/resource wrap dedup) and S7 (MCP Resource MIME-type
  bypass) were tagged "deferred to PR-7" in the plan's technical-review
  pass but reference a B7-sub-4-5 numbering that conflicts with the
  canonical PR-7 scope (B7-sub-1-3 + B8). They were NOT addressed in
  this PR — they belong to the prompt/resource wrap entry points which
  don't yet exist as separate code paths in this codebase. Track in
  follow-up.

## Testing summary

- **Test files added:** 1 (`src/lib/utils/unicode-attack-ranges.ts` — new
  module, no test file because the constants are exercised by every
  `sanitize.test.ts` case).
- **Test files updated:** 3 (`sanitize.test.ts` +35, `processor.test.ts`
  +22, `content-type.test.ts` +7 — and one rewrite of the wider 50-NBSP
  test which previously asserted "NBSP not removed" and is now caught by
  the widened class).
- **Total tests now:** 815 passing, 7 skipped (was 750 / 7 before PR-7,
  net +65). All baseline tests still pass.
- **Build:** `npm run build` clean, no TypeScript errors or warnings.
  All public-API exports unchanged; no re-export added or removed (the
  sanitiser primitive `sanitizeResponse` is already public from PR-1).
- **Lint:** project does not have an ESLint script in `package.json`;
  no separate lint pass.
- **Manual testing:** none required — every behavioural change is
  covered by a regression test, including the 1 MB ReDoS wall-clock
  assertion and the 256 KB skip-cap behavioural assertion (the
  skip-cap test verifies sanitisation still runs above the cap by
  asserting the per-host injection-detection log fires).
- **Test gaps:**
  - No load test of the strip path under sustained adversarial traffic;
    the wall-clock assertion is single-shot.
  - No regression test for the case "decoded entity decodes to a
    surrogate-half codepoint". Out-of-range codepoints drop to empty
    string by the existing range guards (`cp >= 0 && cp <= 0x10ffff`),
    but a surrogate-half (e.g. 0xD800) would technically decode to an
    invalid codepoint. Realistic attacker payloads use complete
    sequences; this is a theoretical edge.

## Commit history

Will appear after commit. Planned single commit:

```
feat(response): widen sanitiser + ReDoS-hardened HTML/markdown stripping (PR-7 / B7-sub-1-3 + B8)
```

## Review context

- **Suggested review order:**
  1. `src/lib/utils/unicode-attack-ranges.ts` — the new taxonomy module.
     Read its top-of-file doc block first.
  2. `src/lib/utils/sanitize.ts` — three-way collapse rule in
     `sanitizeResponse` and the `isWhitespacePaddingMatch` helper.
  3. `src/lib/response/processor.ts` — the strip-path additions. The
     orphan-tag cleanup is the deviation from the plan; the ReDoS
     hardening is the load-bearing security change.
  4. `src/lib/utils/content-type.ts` — `isMarkdownContentType` mirrors
     `supportsMarkupComments` shape.
  5. Test files — the regression coverage and the Unicode escape-form
     readability choices.
  6. `README.md` + `docs/configuration.md` + `src/lib.ts` §7 + the
     in-server documentation resource — doc updates.

- **Plan section:** B7-sub-1-3 lines 902–987, B8 lines 989–1098 of
  `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`. Acceptance
  criteria in both sections are now ticked.

- **Dependency on other work:** PR-6b (defence-in-depth wrap on
  YAML/custom-tool output) is merged on `main` and is the immediate
  predecessor in the recommended landing order. PR-8 (B7-sub-4-5
  detection-pattern expansion — NFKC + synonym variants) is the natural
  next-up; it shares `sanitize.ts` (file conflict) so it lands after
  this PR.

- **Cross-references in plan:** B7-sub-1 (visual-space class widening),
  B7-sub-2 (Unicode invisible range additions), B7-sub-3 (newline-run
  rule), B8 (HTML script/style + markdown beacons), C7 (codepoint table
  extraction), C12 (port-allowlist documentation), S5 (dangerous-scheme
  blocklist), S9 (regex-vs-parse5 trade-off documented inline). All
  converged into this PR. Each is referenced inline at its
  implementation site.

## Follow-up work

- [ ] **PR-8 (B7-sub-4-5)** — detection-pattern expansion (NFKC
  normalisation, widened bounded wildcards, synonym variants). Lands
  after PR-7 (shared `sanitize.ts`).
- [ ] **C5 + S7 (prompt/resource wrap entry points)** — these
  technical-review items reference a "B7-sub-4-5" numbering that
  conflicts with the canonical PR-7/PR-8 numbering. They belong to
  prompt/resource wrap entry points that don't yet exist as separate
  code paths. Track when those entry points are introduced.
- [ ] **Reference-style markdown link strip** — out of scope for PR-7
  but technically a bypass for inline-only stripping. Add if a real
  signal surfaces.
- [ ] **Named HTML entity decode** — out of scope; reconsider if a
  real bypass shows up in the wild.
- [ ] **Bench fixture (`bench/`)** — deferred to PR-9 with the rest of
  the perf-budget framework.
- [ ] **Image-inside-link outer-link strip** — current implementation
  strips the inner image URL only. A recursive markdown parser would
  close the residual surface visibility. PR-8 forward.
- [ ] **C12 narrower port allowlist** — a deployment-side config option
  for stricter localhost port restrictions, if a real signal surfaces.
- [ ] **Final cleanup commit (WBS item 15)** — delete `docs/todos/`
  directory once all 8 PRs have shipped.

### Outstanding Todos
<!-- Todos created this session that still need work — see docs/todos/ for full content -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none_ | — | — | — |

### Resolved Todos
<!-- Recorded before deletion. File no longer exists in docs/todos/. -->
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a plan section, not a `docs/todos/` file_ | — | — | — | — |

---

## Code Review — 2026-05-02

### Review Summary
- **Reviewer:** automated multi-agent review (security-sentinel, code-simplicity-reviewer, typescript-reviewer)
- **Findings:** 🔴 P1: 6 | 🟡 P2: 8 | 🔵 P3: 7
- **All P1 + relevant P2 fixed in commit `[pending]`.** Tests: 815 → 875 passing (net **+60**).

### Handoff Assessment
The original handoff was honest about most trade-offs (image-inside-link
nesting, named-entity-decode false positives, reference-style markdown,
256 KB cap) but **rationalised one real exploitable bypass** as a benign
trade-off: the 256 KB strip-path cap can be evaded by Unicode-padding
inflation. An attacker pads with ~150 KB of U+200B (3 bytes UTF-8 each →
450 KB), pushing the body above the cap; sanitiser collapses padding;
LLM sees a 60-byte response with intact `<script>`. The handoff framed
this as "the sanitiser is regex-bounded so the LLM never sees attack-
class bytes" — true for the bytes but missed that `<script>` blocks ARE
the attack class for prompt injection.

The other non-disclosed gaps were the malformed-closer / unclosed
`<script>` body leak (P1-A), the dangerous-scheme whitespace bypass
(P1-F), and the markdown-content-type skip (P1-D — handoff mentioned
markdown CAN contain raw HTML but called it a "reasonable scope choice"
without acknowledging it as a real bypass).

### Key Findings & Resolutions

| ID | Sev | Category | Description | Resolution |
|----|-----|----------|-------------|-----------|
| P1-A | 🔴 | Security | Malformed `</script>` closer (whitespace before `script`, newline, no closer at all) leaks script body | Replaced balanced `(?:(?!<\/?tag\b)[\s\S])*?<\/tag\s*>` pattern with open-to-closer-or-EOF lazy form `<tag\b[^>]*>[\s\S]*?(?:<\/\s*tag\b[^>]*>\|$)` — handles malformed/unclosed blocks linear-time. Orphan-tag cleanup pass dropped (subsumed). |
| P1-B | 🔴 | Security | 256 KB cap evaded by Unicode-padding inflation (attacker pads with U+200B → strip skips → sanitise collapses padding → LLM sees compact body with intact `<script>`) | Pipeline reordered: **sanitise BEFORE strip** so the byte-cap is checked against post-sanitise size. Detection still runs on original via `sanitizeAndDetect`'s S4 ordering. |
| P1-C | 🔴 | Security | `decodeNumericHtmlEntities` accepts surrogate halves (0xD800–0xDFFF) → emits malformed UTF-16 → downstream substitution / parser crashes / homoglyph confusion | Tightened range guard to `cp >= 0 && cp <= 0x10FFFF && (cp < 0xD800 \|\| cp > 0xDFFF)`; `Number.isFinite` → `Number.isInteger`. |
| P1-D | 🔴 | Security | `text/markdown` content-type skipped `<script>`/`<style>` strip — markdown allows raw HTML and every mainstream renderer passes it through | Added `isMarkdownContentType` to the strip branch in `processResponse`. |
| P1-E | 🔴 | Security | Markdown URL pattern `[^\s)]` rejected title-syntax `(url "title")` and Wikipedia-style URLs containing `)` | Widened URL char class to `[^)\n]`; added optional `\s*` after `\(` for CommonMark `[label]( url )` shape. |
| P1-F | 🔴 | Security | Dangerous-scheme regex bypassed by whitespace after the colon (`javascript: alert(1)`) and leading whitespace before the scheme | Same widening as P1-E applied to the dangerous-scheme pattern. |
| P2-A | 🟡 | Security | Sanitiser whitespace-padding bypass via attack-char interleaving: `(49 spaces + ZWSP) × N` had each ZWSP removed individually and each 49-space run preserved → output 1029 contiguous spaces | Idempotence loop in `sanitizeResponse` (cap = 4); 2 iterations close the interleaving class. |
| P2-B | 🟡 | SRP | `processor.ts` doubled to 290+ lines; strip subsystem (~140 LOC of patterns/helpers/tunables/doc) was foreign matter inside an orchestration file (PR-6b precedent: extracted post-processor.ts) | Extracted `src/lib/response/strip-blocks.ts` with `stripBlocksFixedPoint`, `stripHtmlComments`, `stripMarkdownBeacons` exports + co-located `strip-blocks.test.ts`. `processor.ts` back to ~150 lines, orchestration story restored. |
| P2-D | 🟡 | TypeScript | `unicode-attack-ranges` exports public/internal status was ambiguous (not in barrel, no `@internal` tag) | Added module-level `@internal` doc comment with explicit "not re-exported" + pointer to public primitives. |
| P2-F | 🟡 | DRY | `decodeNumericHtmlEntities` had two near-identical `.replace()` passes (hex / decimal) | Collapsed to single regex with hex/decimal alternation; one full-body scan instead of two per fixed-point iteration. |
| P2-G | 🟡 | TypeScript | `isWhitespacePaddingMatch` and `WHITESPACE_PADDING_CLASS` were parallel definitions in different files — silent desync risk | Single source of truth: `WHITESPACE_PADDING_CODEPOINTS` (discrete + ranges) in `unicode-attack-ranges.ts`; `WHITESPACE_PADDING_CLASS` derived from it via a formatter; `isWhitespacePaddingMatch` consumes it directly. |
| P2-H | 🟡 | TypeScript | No runtime type guard at `processResponse` entry — JS callers (custom-tool hooks) could pass non-string and trigger an unhelpful `TypeError` deep in `Buffer.byteLength` | Added `if (typeof response !== "string") throw new TypeError(...)` at entry. |

### Decisions explicitly NOT made / consciously deferred
| Finding | Decision | Reason |
|---------|----------|--------|
| P2-C — flatten `unicode-attack-ranges.ts` named-class structure | **Rejected** | The named-class structure DOES earn its keep now that P2-G derives the whitespace classifier from it — the 17 attack-class constants serve as anchor points for the doc-comment taxonomy (per range Reference / per class Why). Reviewer's "no consumers" critique is valid for the previous ceremonial form; not for the post-P2-G derivation form. |
| P2-E — orphan-tag union (4 patterns → 1) | **Skipped** | The orphan-tag pass was dropped entirely as part of P1-A — the new open-to-closer-or-EOF strip pattern subsumes it. Nothing left to deduplicate. |
| P3-A — markdown image/link `(!?)` capture | **Rejected** | I tried this in an early pass; it broke the image-inside-link nesting case (greedy label consumed the inner `[`, treating the inner `]…)` as a link). Two-pattern shape with `(?<!!)` lookbehind preserves the image-vs-link distinction in nested cases. Documented inline in `strip-blocks.ts`. |
| P3-B — reference-style markdown links | **Deferred** | Already disclosed in handoff Known Issues; out of scope for this round. |
| P3-C — image-inside-link outer URL strip | **Deferred** | Same reason; documented trade-off. |
| P3-E — numeric-entity false positives on legitimate `<pre>&#x3c;…&#x3e;</pre>` code samples | **Deferred** | Reviewer flagged this as content-integrity not security. The risk direction we care about (missing an attack) is the safer default. Documented in the doc-comment on `decodeNumericHtmlEntities`. |

### Verified Claims
| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (815/7 baseline) | ✓ | Confirmed; now 875/7 after review fixes |
| Build clean | ✓ | `npm run build` passes |
| ReDoS-hardened (1 MB wall-clock < 100 ms) | ✓ | Re-verified after pattern change to lazy + alternation form; new pattern is also linear-time per match |
| Self-healing payload neutralised | partial | OLD pattern + orphan strip left a residue claim was wrong; NEW pattern + fixed-point loop genuinely neutralises (regression test in `strip-blocks.test.ts`) |
| 256 KB cap is "the sanitiser is regex-bounded so the LLM never sees attack-class bytes" | **NO** | Cap evaded by U+200B padding inflation. Pipeline reordered (P1-B fix). |
| Markdown content-type get correct stripping | partial-NO | Markdown DID skip script/style strip per the handoff's own pipeline-wiring note. P1-D fixed. |

### Outstanding Todos
<!-- Todos created during this review — see docs/todos/ for full content -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — review fixes implemented in-place; no follow-up todo files needed_ | — | — | — |

### Blockers
None — all P1 fixed; relevant P2 fixed; deferred items are deliberately scoped trade-offs. Clear to merge after a reviewer sanity-check on the new `strip-blocks.ts` module.

### Files Modified (review pass)
- `src/lib/response/strip-blocks.ts` (NEW — 220 lines, extracted strip subsystem with P1-A/C/E/F fixes)
- `src/lib/response/strip-blocks.test.ts` (NEW — 36 cases of direct strip-primitive coverage)
- `src/lib/response/processor.ts` (rewritten — 165 lines, pipeline reorder + markdown branch + type guard)
- `src/lib/response/processor.test.ts` (+22 cases for review-pass P1 regression)
- `src/lib/utils/sanitize.ts` (idempotence loop + derive `isWhitespacePaddingMatch` from shared codepoint table)
- `src/lib/utils/sanitize.test.ts` (+4 cases for whitespace-interleaving bypass regression)
- `src/lib/utils/unicode-attack-ranges.ts` (`@internal` JSDoc + new `WHITESPACE_PADDING_CODEPOINTS` source-of-truth + derived `WHITESPACE_PADDING_CLASS`)

### Tests / build
- `npm test`: 875/875 passing (7 skipped) — was 815/7 before review fixes, **net +60 regression tests**.
- `npm run build`: clean.
