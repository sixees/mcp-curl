// src/lib/response/strip-blocks.ts
// HTML / markdown content-strip subsystem for the response pipeline.
//
// Threat model: attacker controls HTTP response bytes; the strip path
// neutralises `<script>` / `<style>` blocks (HTML / XHTML / SVG / *+xml /
// markdown) and markdown beacon URLs (image / link / dangerous-scheme).
// The caller sequences these: `processor.ts` sanitises and detects FIRST
// (Step 2, so padding cannot inflate a body past the cap below), strips
// here (Steps 3-4), then sanitises and detects again (Step 5) because the
// entity decode can unmask an injection phrase Step 2 could not see.
//
// Cost is bounded by the patterns, not by the 256 KB cap: a `g`-flagged
// replace starts a match attempt at every position, so a failing attempt
// that can scan forward without limit is quadratic however small the input
// is (ARCHITECTURE.md invariant 15). The cap is a circuit-breaker and the
// 4-iteration fixed-point loop bounds the numeric-entity decode; neither is
// what makes this path linear, and neither is what makes the tag and comment
// strips converge — those scan the output tail and need no iteration at all.
//
// **Best-effort textual sanitisation, not a full HTML sandbox.** We
// considered `parse5` (zero false positives, no ReDoS class) but rejected
// it: 60 KB minified, 2× slower on small bodies, adds a runtime dep.
// Acceptable for our threat model — content reaches an LLM, not a
// renderer.

import { FIXED_POINT_MAX_ITERATIONS } from "../config/limits.js";

/**
 * Replacement strings written by `stripMarkdownBeacons` over removed
 * markdown URL surfaces. Exported so tests can import the source of
 * truth instead of duplicating the literal strings.
 */
export const IMAGE_REMOVED_PLACEHOLDER = "[image removed]";
/** @see IMAGE_REMOVED_PLACEHOLDER */
export const LINK_REMOVED_PLACEHOLDER = "[link removed]";

/**
 * 256 KB cap for the HTML-block-strip path. Above the cap the strip step
 * is skipped entirely and the caller's `sanitiseAndDetect` is the only
 * defence.
 *
 * **It caps the input, not the cost.** A quadratic pattern is still
 * quadratic below the cap — at 256 KB the pre-fix patterns took 82 seconds
 * (invariant 15). Linearity is the patterns' job; this is a size policy.
 *
 * The pipeline orders sanitise BEFORE strip so visible-space-padding
 * inflation can't push the strip target above this cap (PR-7 round 2).
 *
 * **Deliberately smaller than `LIMITS.DEFAULT_MAX_RESULT_SIZE` (500 KB).**
 * Bodies in the 256 KB–500 KB range are returned inline without strip-pass
 * processing — defence-in-depth, not a sandbox; the always-on sanitiser
 * (no size cap) is the primary defence and runs unconditionally on the
 * full body. The strip cap is therefore a circuit-breaker for the ReDoS-
 * adjacent fixed-point loop, not a content-size policy.
 *
 * **Exported `@internal`** so the caller (`processor.ts`) can gate the
 * full strip path (Steps 3, 4, 5 — including `stripMarkdownBeacons`) on
 * the same cap. Round-2 lifted the label/URL caps inside the markdown
 * patterns; without an outer-level gate the unbounded replaces could
 * scan multi-MB bodies and the cap inside `stripBlocksFixedPoint` would
 * not bound `stripMarkdownBeacons`'s cost.
 */
export const STRIP_PATH_MAX_BYTES = 256 * 1024;

/**
 * Fixed-point iteration cap for {@link stripBlocksFixedPoint}.
 *
 * **What it bounds is the numeric-entity decode, and only that.** Each
 * iteration peels one encoding layer, so `&#x26;#x3c;script&#x26;#x3e;` needs
 * two and 4 caps how deep a nested encoding this path will chase. The loop
 * exits early when the passes converge (`next === curr`).
 *
 * **It is not what neutralises a self-healing payload, and reading it as that
 * is what made the same decline wrong twice.** A cap on an iterated `replace`
 * only moves the surviving splice depth to the cap, and the attacker picks the
 * depth (`LESSONS.md` RC-13). {@link stripTagTokens} and
 * {@link stripHtmlComments} converge by scanning the output tail instead, so
 * splice depth costs no iteration here at all.
 *
 * Imported from `config/limits.ts` so this cap and the parallel sanitiser
 * cap (`utils/sanitize.ts → SANITIZE_FIXED_POINT_MAX_ITERATIONS`) cannot
 * drift independently.
 */
const STRIP_FIXED_POINT_MAX_ITERATIONS = FIXED_POINT_MAX_ITERATIONS;

// -----------------------------------------------------------------------------
// Module-private regex constants — `g`/`gi` flags make these stateful (they
// track `lastIndex` across calls). They are used **exclusively** with
// `String.prototype.replace`, which iterates internally and does not consume
// `lastIndex` — that means the shared module-scope regex objects are safe to
// reuse across requests. Never call `.test()` or `.exec()` on these patterns:
// both consult `lastIndex` and would corrupt subsequent calls. If a future
// callsite needs `.test`/`.exec`, build a fresh `new RegExp(source, flags)`
// per call instead of importing one of these constants.
// -----------------------------------------------------------------------------

/**
 * Strip patterns for BALANCED `<script>` / `<style>` blocks.
 *
 * Shape: `<tag\b[^>]*>[\s\S]*?</\s*tag\b[^<>]*>`
 *
 * - **Body** uses lazy `[\s\S]*?` rather than the older negative-lookahead
 *   `(?:(?!<\/?tag\b)[\s\S])*?` — each lazy expansion does an O(1) check of
 *   the closer, and it removes the self-healing-payload edge case where the
 *   older form left a `<script>` orphan in the residue.
 * - **Closer** allows whitespace-or-newline between `</` and `tag` (`\s*`
 *   absorbs `</ script>`, `</\nscript>`), accepts attributes after the
 *   tag name, and is case-insensitive (`i` flag). That attribute run is
 *   `[^<>]*` rather than `[^>]*`: a closer that swallows `<` swallows OPENERS,
 *   which is how `"</script " + "<script".repeat(35000) + ">"` stayed
 *   quadratic at 9 s. A closing tag takes no attributes anyway, and one this
 *   rejects still loses both its tags to {@link stripTagTokens}.
 * - **Word boundary** `\b` after the tag name avoids matching
 *   `<scriptlike>` / `<stylesheet>` etc.
 *
 * **Unclosed forms are NOT handled here.** These patterns carried an `|$)`
 * open-to-end-of-input arm until 3.4.0; it deleted the rest of the payload on
 * any orphan opener, so it was replaced by {@link stripTagTokens} below. Between
 * the two, no `<script` / `</script` / `<style` / `</style` token survives a
 * pass — the property the `|$)` arm was actually carrying. `LESSONS.md` RC-11.
 *
 * **Linear per match is not linear per pass.** Each lazy expansion costs O(1),
 * so one match attempt is linear — but a `g`-flagged replace starts an attempt
 * at every position, so O(n) failing attempts of O(n) each is O(n²). An earlier
 * revision of this comment reasoned from the per-match property to "the 256 KB
 * cap guarantees wall-clock < 100 ms on any adversarial input"; that was wrong
 * by roughly 800× (4.5 s here, 82 s for the markdown patterns below).
 *
 * Cost is bounded by construction instead — see {@link withinClosableRegion},
 * which every pass in this file goes through. **The first attempt at that bound
 * keyed on the last `>` and was wrong**: `</script>` needs the tag name, not an
 * angle bracket, so `"<script>".repeat(32000)` kept the whole input in scope
 * and still took 1.1 s. The bound now keys on each pattern's own closing token.
 * `LESSONS.md` RC-11.
 */
const SCRIPT_BLOCK_PATTERN =
    /<script\b[^>]*>[\s\S]*?<\/\s*script\b[^<>]*>/gi;
const STYLE_BLOCK_PATTERN =
    /<style\b[^>]*>[\s\S]*?<\/\s*style\b[^<>]*>/gi;

/**
 * Markdown image / link beacon patterns. Both:
 *   - Use `[^\]\[\n]*` (unbounded) for the alt/label portion. Neither `]`
 *     nor `[` may appear in a label. `]` is the label's terminator; `[` is
 *     excluded so a failing attempt cannot scan forward from every `[` in the
 *     body — 256 KB of `[` measured 82 seconds, synchronously.
 *
 *     **That exclusion is not on its own what makes the pass linear, and an
 *     earlier revision of this docblock said it was.** It bounds the LABEL;
 *     the URL class `[^)\n]+` was left free to scan to end-of-input, so
 *     `"[a](https://x".repeat(19000)` still took 2.9 s. Linearity comes from
 *     the `)` bound in `stripMarkdownBeacons` (ARCHITECTURE.md invariant 15).
 *
 *     **Known cost of the `[` exclusion:** a CommonMark-legal label that
 *     itself contains brackets — `[see [1]](https://host/x)` — matches none
 *     of the four patterns and its URL is returned intact. Pre-existing (the
 *     `]` exclusion alone already broke it) and tracked in `docs/todos/005`.
 *     A fix must not restore an unbounded forward scan.
 *
 *     Earlier revisions capped the label at 256 chars to "defeat
 *     catastrophic backtracking". That was a load-bearing **bypass** —
 *     padding a label past 256 chars defeated all four patterns — and it
 *     did not bound cost either. Length caps are the wrong instrument for
 *     both jobs; the character class is the right one.
 *   - Use `[^)\n]+` (unbounded) for the URL portion. Same reasoning: the
 *     previous 2048-char cap was the same bypass class for over-cap URLs,
 *     and `)` terminates the scan.
 *   - Allow optional whitespace after the opening paren so CommonMark's
 *     `[label]( url )` shape matches.
 *   - Require an http(s) scheme — non-http schemes are handled by
 *     {@link MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN} and its link
 *     counterpart below. Same-origin or relative URLs (no scheme) are
 *     deliberately preserved.
 *
 * Two separate patterns rather than a single `(!?)`-captured pattern:
 * the link pattern's `(?<!!)` negative lookbehind keeps image syntax
 * `![alt](url)` from being matched as a link by the link strip — vital
 * for the image-inside-link nesting case, where running images first
 * (lookbehind-free) and links second (lookbehind-required) preserves
 * the image-vs-link distinction. All maintained Node LTS versions support
 * negative lookbehind.
 */
const MARKDOWN_EXTERNAL_IMAGE_PATTERN =
    /!\[[^\]\[\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;
const MARKDOWN_EXTERNAL_LINK_PATTERN =
    /(?<!!)\[[^\]\[\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;

/**
 * Dangerous-scheme blocklist for markdown URLs (S5). Strips links and
 * images whose href uses a scheme known to carry script payloads or
 * local-file disclosure: `javascript:`, `vbscript:`, `file:`, `data:`.
 * Runs FIRST so the http(s) external patterns don't have to know about
 * non-http schemes.
 *
 *   - Allows leading `\s*` after `\(` for `[a]( javascript:foo)` shape.
 *   - URL char class `[^)\n]` permits whitespace after the colon
 *     (`javascript: alert(1)`) — markdown renderers trim this, so the
 *     strip needs to match it.
 *   - Two separate image/link patterns for the same nesting reason as
 *     {@link MARKDOWN_EXTERNAL_IMAGE_PATTERN}.
 */
const MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN =
    /!\[[^\]\[\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;
const MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN =
    /(?<!!)\[[^\]\[\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;

/**
 * Residual dangerous-scheme cleanup pattern. Strips `(scheme:…)` URL
 * portions that survive the standard label-aware passes — specifically
 * the image-inside-dangerous-link nesting case
 * `[![alt](https://safe/img.png)](javascript:alert(1))`:
 *
 *   - `MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN` cannot match the OUTER
 *     because the inner `[` of `![alt]` — and then its `]` — each end the
 *     outer pattern's `[^\]\[\n]` label class before reaching the outer
 *     `)`. (Before 3.4.0 only the `]` did; the `[` exclusion added for
 *     linearity makes it fail one character earlier, same outcome.)
 *   - `MARKDOWN_EXTERNAL_IMAGE_PATTERN` THEN replaces the inner image
 *     with `[image removed]`, leaving residue `[[image removed]](javascript:...)`.
 *   - `MARKDOWN_EXTERNAL_LINK_PATTERN` doesn't match — URL is `javascript:`,
 *     not http(s).
 *
 * After-pass: lookbehind `(?<=\])` requires the URL to be preceded by a
 * `]` (i.e., it MUST sit at a markdown-link boundary), bounding false-
 * positive risk on legitimate prose mentioning `(javascript:foo)`. The
 * URL char class `[^)\n]*` mirrors the standard patterns' — uncapped, and
 * bounded by `)` rather than by a length limit.
 */
const MARKDOWN_DANGEROUS_SCHEME_RESIDUAL_PATTERN =
    /(?<=\])\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;

/**
 * Decode numeric HTML entities (`&#xNN;` / `&#NNN;`) so payloads like
 * `&#x3c;script&#x3e;` cannot smuggle past the strip patterns. Decoded
 * once per fixed-point iteration entry.
 *
 * **Surrogate halves (U+D800–U+DFFF) are deliberately dropped to empty
 * string.** `String.fromCodePoint` happily produces lone surrogates which
 * propagate as malformed UTF-16 to downstream consumers (Buffer encoders
 * substitute U+FFFD; JSON serialisers may emit `"\udXXX"` literally and
 * crash strict parsers). The codepoint clamp `cp < 0xD800 || cp > 0xDFFF`
 * closes that observability/transport hazard.
 *
 * **Out-of-range codepoints** (NaN, negative, > 0x10FFFF) silently drop
 * to empty string. `Number.isInteger` rejects floats and NaN; the
 * explicit range guard is defence-in-depth.
 *
 * **Named entities** (`&amp;`, `&lt;`, `&gt;`) are intentionally left
 * alone — they don't directly carry `<script>` shapes, and decoding them
 * risks re-introducing literal `<` characters into legitimate code-block
 * content. Numeric entities are the realistic smuggling vector.
 *
 * Single regex with hex/decimal alternation rather than two separate
 * passes — one full-body scan instead of two per fixed-point iteration.
 */
function decodeNumericHtmlEntities(input: string): string {
    return input.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, body: string) => {
        const cp =
            body[0] === "x" || body[0] === "X"
                ? Number.parseInt(body.slice(1), 16)
                : Number.parseInt(body, 10);
        if (
            !Number.isInteger(cp) ||
            cp < 0 ||
            cp > 0x10ffff ||
            (cp >= 0xd800 && cp <= 0xdfff)
        ) {
            return "";
        }
        return String.fromCodePoint(cp);
    });
}

/**
 * Strip `<script>` and `<style>` blocks (tag + content). Bodies above
 * {@link STRIP_PATH_MAX_BYTES} skip the strip path entirely — the caller's
 * sanitiser is the only defence above the cap.
 *
 * **The loop is for the decode, not for the strip.** A self-healing payload is
 * neutralised inside {@link stripTagBlocks}, whose token sweep converges on its
 * own; iterating a `replace` would only move the surviving splice depth to the
 * cap (`LESSONS.md` RC-13).
 *
 * **Numeric-entity decode runs INSIDE the loop**, not once at entry, so
 * nested encodings like `&#x26;#x3c;script&#x26;#x3e;` (where `&#x26;`
 * decodes to `&`, exposing `&#x3c;script&#x3e;` for the next iteration's
 * decode to turn into `<script>`) are caught. Decoding once at entry left
 * a single layer unmasked; a payload encoded twice would survive the
 * strip with the inner attack-token shape intact.
 *
 * Returns the input unchanged when no further reductions are possible.
 *
 * @param input - text content to strip (caller is responsible for
 *                content-type gating; this function does not check it)
 */
export function stripBlocksFixedPoint(
    input: string,
    options: { decodeEntities?: boolean } = {}
): string {
    const { decodeEntities = true } = options;
    if (Buffer.byteLength(input, "utf8") > STRIP_PATH_MAX_BYTES) return input;
    let curr = input;
    for (let i = 0; i < STRIP_FIXED_POINT_MAX_ITERATIONS; i++) {
        const decoded = decodeEntities ? decodeNumericHtmlEntities(curr) : curr;
        const next = stripTagBlocks(decoded);
        if (next === curr) return next;
        curr = next;
    }
    return curr;
}

/**
 * Run `pass` over only the prefix of `text` in which a match can complete,
 * returning everything beyond it untouched.
 *
 * **This is the one mechanism that keeps this file linear, and every pattern
 * here goes through it.** A `g`-flagged replace starts a match attempt at every
 * position. An attempt that SUCCEEDS consumes forward, so those are amortised
 * linear; an attempt that FAILS after scanning to end-of-input is what costs
 * O(n) each and O(n²) per pass. Every pattern in this file must consume a
 * literal closing token — `-->`, `</script…>`, `)` — so within a prefix ending
 * at the last such token, every start position has a closer ahead of it and
 * cannot fail that way.
 *
 * **Sound, not approximate.** No match can BEGIN after the last closer, because
 * every match contains one. Text beyond it therefore cannot hold any part of a
 * match, and skipping it changes no output. That is what makes this a bound and
 * not a cap: `STRIP_PATH_MAX_BYTES` limits the input, this limits the search to
 * where an answer could be.
 *
 * `end <= 0` means no closer exists at all, so the pass has no work to do.
 *
 * @param end - index just past the last closing token, from one of the
 *              `…CloserEnd` helpers below
 */
function withinClosableRegion(text: string, end: number, pass: (s: string) => string): string {
    if (end <= 0) return text;
    if (end >= text.length) return pass(text);
    return pass(text.slice(0, end)) + text.slice(end);
}

/**
 * Single whitespace character. No `g`/`y` flag, so `.test()` does not consult
 * `lastIndex` and reuse across calls is safe — see the safety contract above.
 */
const WHITESPACE_CHAR_PATTERN = /\s/;

/**
 * Single `\w` character — the class JS `\b` is defined against.
 * No `g`/`y` flag, so `.test()` is safe to reuse; see the safety contract above.
 */
const WORD_CHAR_PATTERN = /\w/;

/**
 * Case-insensitive ASCII compare of `tag` against `text` at `at`, WITHOUT
 * lowercasing the input.
 *
 * **`text.toLowerCase()` cannot be used to find offsets into `text`.** Lowercase
 * mappings can change UTF-16 length — U+0130 (`İ`) lowercases to two units — so
 * an index taken from the folded copy addresses a different character in the
 * original. That misaligned every check in {@link lastTagCloserEnd} after any
 * such character, which on `İ<script>…</script>` skipped the balanced pass
 * entirely. Reported on PR #33 by chatgpt-codex-connector.
 *
 * `| 0x20` folds ASCII letters and leaves everything else unequal to one, which
 * is all this needs: the tag names it compares are ASCII by construction.
 */
function matchesTagNameAt(text: string, at: number, tag: string): boolean {
    if (at + tag.length > text.length) return false;
    for (let k = 0; k < tag.length; k++) {
        if ((text.charCodeAt(at + k) | 0x20) !== tag.charCodeAt(k)) return false;
    }
    return true;
}

/** Index just past the last `closer`, or 0 when the input holds none. */
function lastCloserEnd(text: string, closer: string): number {
    const i = text.lastIndexOf(closer);
    return i === -1 ? 0 : i + closer.length;
}

/**
 * Index just past the `>` terminating the last COMPLETE `</tag …>` closer, or 0.
 *
 * Three properties are load-bearing and each was learned by getting it wrong:
 *
 * 1. **A bare `>` is not this token.** `</script>` needs the tag name, so
 *    `"<script>".repeat(32000)` — every character before a `>` — left the whole
 *    input in scope and each opener scanned to end-of-input: 1.1 s measured.
 * 2. **The name needs the same `\b` the pattern requires.** `</scripture>` is
 *    not a script closer, and accepting it as one put
 *    `"<script></scripture>".repeat(13000)` back in scope at 1.9 s.
 * 3. **The attribute run may not contain `<`.** A closer whose `[^>]*` suffix
 *    spans openers puts them inside the bound with no closer of their own after
 *    them — `"</script " + "<script".repeat(35000) + ">"` measured 9 s. The
 *    pattern's own closer is `[^<>]*` for the same reason, so the two agree.
 *    Excluding `<` from a CLOSER is safe in a way it is not for an opener: a
 *    closing tag takes no attributes, and a closer this rejects still has both
 *    its tags removed by {@link stripTagTokens}.
 *
 * All three reported on PR #33 by chatgpt-codex-connector, rounds 1 and 2.
 *
 * Linear: the outer loop visits each index once, and the whitespace and
 * attribute walks cover disjoint spans.
 */
function lastTagCloserEnd(text: string, tag: string): number {
    let end = 0;
    for (let i = 0; i + 1 < text.length; i++) {
        if (text[i] !== "<" || text[i + 1] !== "/") continue;
        let j = i + 2;
        while (j < text.length && WHITESPACE_CHAR_PATTERN.test(text[j]!)) j++;
        if (!matchesTagNameAt(text, j, tag)) continue;
        j += tag.length;
        // The `\b` the pattern requires: `</scripture>` is not a script closer.
        if (j < text.length && WORD_CHAR_PATTERN.test(text[j]!)) continue;
        // The attribute run, which may not contain `<`. See the note above.
        while (j < text.length && text[j] !== ">" && text[j] !== "<") j++;
        if (text[j] === ">") end = j + 1;
    }
    return end;
}

/**
 * One pass of the script/style strip.
 *
 * Two balanced `replace` passes, each bounded at its own closing token, then
 * {@link stripTagTokens} over the whole string.
 *
 * **The order is what makes the balanced passes safe.** They can splice — a
 * removal rejoins its neighbours, so `<scr<script>x</script>ipt>` becomes
 * `<script>` — and the scan that follows is unconditional and covers the whole
 * string, so any token they leave behind is removed. CodeQL flags both replaces
 * for that residue; the decline stands on this ordering, and NOT on the
 * iteration cap that made the same decline wrong twice (`LESSONS.md` RC-13).
 * A seeded fuzz over the token alphabet asserts the property directly.
 */
function stripTagBlocks(text: string): string {
    let out = withinClosableRegion(text, lastTagCloserEnd(text, "script"), (s) =>
        s.replace(SCRIPT_BLOCK_PATTERN, "")
    );
    out = withinClosableRegion(out, lastTagCloserEnd(out, "style"), (s) =>
        s.replace(STYLE_BLOCK_PATTERN, "")
    );
    return stripTagTokens(out);
}

/** Tag names this file neutralises. The set and its handlers are one site. */
const STRIPPED_TAG_NAMES = ["script", "style"] as const;

/**
 * Last character of each name in {@link STRIPPED_TAG_NAMES}, as the fold used
 * for comparison. Cheap rejection: {@link tagTokenStart} runs after every
 * character, and only a `t` or an `e` can complete one of these names.
 */
const STRIPPED_TAG_LAST_CHARS = new Set(
    STRIPPED_TAG_NAMES.map((n) => n.charCodeAt(n.length - 1))
);

/**
 * If `out` ends with a `<tag` / `</tag` token, the index where it starts;
 * otherwise -1. Whitespace after `</` is allowed, matching the closer form the
 * block patterns accept.
 */
function tagTokenStart(out: string[]): number {
    const last = out[out.length - 1]!.charCodeAt(0) | 0x20;
    if (!STRIPPED_TAG_LAST_CHARS.has(last)) return -1;
    for (const name of STRIPPED_TAG_NAMES) {
        const k = out.length - name.length;
        if (k < 1) continue;
        let matched = true;
        for (let m = 0; m < name.length; m++) {
            if ((out[k + m]!.charCodeAt(0) | 0x20) !== name.charCodeAt(m)) {
                matched = false;
                break;
            }
        }
        if (!matched) continue;
        let j = k - 1;
        while (j >= 0 && WHITESPACE_CHAR_PATTERN.test(out[j]!)) j--;
        if (j >= 0 && out[j] === "/") j--;
        if (j >= 0 && out[j] === "<") return j;
    }
    return -1;
}

/**
 * Remove every `<script>` / `<style>` / `</script>` / `</style>` TAG, keeping
 * whatever sat between them as inert text (`LESSONS.md` RC-11).
 *
 * **A scan rather than a `replace`, for the reason the comment strip is one.**
 * Deleting a tag can splice a new one out of its neighbours — removing the
 * inner tag from `<scr<script>ipt>` rejoins `<scr` and `ipt>` into `<script>` —
 * and a `replace` exposes exactly ONE layer per pass. Wrapping it in
 * `stripBlocksFixedPoint`'s four-iteration loop therefore does not converge: it
 * moves the surviving depth to four, and an attacker picks the depth.
 * `"<scr".repeat(4) + "<script>" + "ipt>".repeat(4)` returned a live
 * `<script>`.
 *
 * **This was declined twice before it was fixed.** CodeQL reported it as
 * incomplete multi-character sanitisation on both of the first two review
 * rounds, and both times the reply was that the fixed-point loop handles the
 * splice — true only below the cap, which is the part the rule was pointing at.
 * The comment path had the identical defect fixed one commit earlier, so the
 * decline survived a round in which its mirror image was being repaired.
 * Reported as a class by coderabbitai on PR #33.
 *
 * Scanning removes the cap from the argument: the token test runs against the
 * OUTPUT tail after every character, so anything a removal splices together is
 * examined on the next push and convergence needs no iteration at all. One
 * pass, and at most one failed `>` search — the `noGt` latch makes it at most
 * one, since a search failing from `i` fails from every later position.
 */
function stripTagTokens(text: string): string {
    const out: string[] = [];
    let i = 0;
    let noGt = false;
    while (i < text.length) {
        out.push(text[i]!);
        i++;
        const start = tagTokenStart(out);
        if (start === -1) continue;
        // The `\b` the block patterns require: `<scriptlike>` is not a tag.
        if (i < text.length && WORD_CHAR_PATTERN.test(text[i]!)) continue;
        out.length = start;
        if (noGt) continue;
        const gt = text.indexOf(">", i);
        if (gt === -1) noGt = true;
        else i = gt + 1;
    }
    return out.join("");
}

/**
 * Strip HTML comments (`<!-- … -->`) from input. Exported as a separate
 * step so the caller can sequence it as part of the response pipeline.
 *
 * **A single left-to-right scan, and deliberately not a regex.** Two defects
 * killed the regex form and neither had a fix at that layer:
 *
 * - **Cost.** `<!--[\s\S]*?-->` scans to end-of-input from every opener that
 *   has no closer ahead: `"<!--".repeat(65536)` took 5.5 s.
 * - **Splicing.** Deleting a literal can form a new one out of its neighbours —
 *   `<!<!----` loses the inner `<!--` and the surviving `<!` and `--` join into
 *   a fresh opener. Iterating a `replace` only pushes that out by one layer per
 *   pass, so `"<!".repeat(5) + "--".repeat(5)` still returned a live `<!--` at
 *   the four-iteration cap. Both reported on PR #33, by chatgpt-codex-connector
 *   and CodeQL's incomplete multi-character sanitisation rule.
 *
 * Scanning fixes both at once because it tests the OUTPUT tail rather than the
 * input: whatever a removal splices together is re-examined on the next
 * character, so convergence needs no iteration cap and cannot be outrun by
 * adding layers. Cost is one pass plus, at most, one failed `-->` search — the
 * `noCloser` latch is what makes that "at most one", since a search that fails
 * from position i fails from every later position too.
 *
 * Balanced comments are removed whole. An orphan opener has its TOKEN removed
 * and its body kept as inert text, which is the RC-11 property: no comment
 * token survives, and no text the caller sent is deleted.
 */
export function stripHtmlComments(input: string): string {
    const out: string[] = [];
    let i = 0;
    let noCloser = false;
    while (i < input.length) {
        out.push(input[i]!);
        i++;
        const n = out.length;
        if (
            n < 4 ||
            out[n - 1] !== "-" ||
            out[n - 2] !== "-" ||
            out[n - 3] !== "!" ||
            out[n - 4] !== "<"
        ) {
            continue;
        }
        out.length = n - 4;
        if (noCloser) continue;
        const close = input.indexOf("-->", i);
        if (close === -1) {
            noCloser = true;
            continue;
        }
        i = close + 3;
    }
    return out.join("");
}

/**
 * Strip dangerous-scheme markdown links/images and external markdown
 * image / link beacons. Replaces the surface form with `[image removed]`
 * / `[link removed]` so the LLM still sees the surrounding label text
 * but cannot follow the URL.
 *
 * Order matters:
 *   1. Dangerous-scheme images (`javascript:`, `vbscript:`, `file:`,
 *      `data:`) → `[image removed]`.
 *   2. Dangerous-scheme links (same scheme set) → `[link removed]`.
 *      The `(?<!!)` lookbehind on the link pattern requires the image
 *      pass to have already consumed any `![alt](js:…)` shape, otherwise
 *      the link pattern would match the inner `[label](js:…)` of an
 *      image-shaped payload.
 *   3. External http(s) image beacons → `[image removed]`.
 *   4. External http(s) links → `[link removed]`.
 *   5. Residual dangerous-scheme cleanup. Catches the
 *      `[![safe-img](http://x)](javascript:foo)` nesting case where the
 *      inner `]` of `[image removed]` (placed by step 3) blocks step 2's
 *      label class from reaching the outer `(javascript:…)`. The
 *      `(?<=\])` lookbehind constrains the strip to markdown-link-
 *      shaped contexts so legitimate prose like "the `javascript:` URL
 *      scheme" survives unscathed.
 */
export function stripMarkdownBeacons(input: string): string {
    // Bounded at the last `)`, the closing token every pattern here must
    // consume. Excluding `[` from the LABEL class left the URL class
    // `[^)\n]+` free to scan forward without limit, so
    // `"[a](https://x".repeat(19000)` — no `)` anywhere — still took 2.9 s.
    // All five passes share one region: none of the replacements contains a
    // `)`, so the boundary cannot move underneath them, and the tail holds no
    // `)` at all so no match can occur there.
    return withinClosableRegion(input, lastCloserEnd(input, ")"), (s) =>
        s
            .replace(MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER)
            .replace(MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER)
            .replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER)
            .replace(MARKDOWN_EXTERNAL_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER)
            .replace(MARKDOWN_DANGEROUS_SCHEME_RESIDUAL_PATTERN, "")
    );
}

/**
 * Returns `true` when the input would cause `stripBlocksFixedPoint` to
 * skip its work due to the {@link STRIP_PATH_MAX_BYTES} cap. The strip
 * function silently returns the input unchanged in that case (a
 * defensive fail-open posture so the strip subsystem never breaks the
 * handler boundary). This helper lets callers observe the skip and
 * decide whether to apply a fallback defence (e.g. force save-to-file,
 * decline to inline above-cap bodies, log a warning).
 *
 * `processor.ts` does not need this — it already gates the entire strip
 * path (Steps 3-5) on the same cap upstream. Future direct callers of
 * `stripBlocksFixedPoint` (PR-8 detection-pattern expansion, custom
 * strip variants, test helpers) should consult it rather than relying
 * on the silent-skip behaviour.
 */
export function wasStripSkipped(input: string): boolean {
    return Buffer.byteLength(input, "utf8") > STRIP_PATH_MAX_BYTES;
}

// NOT exported — `i` flag, used only with `.test()` on input strings.
// `RegExp.prototype.test` does NOT consume `lastIndex` when the regex
// has no `g`/`y` flag, so reuse across calls is safe.
const MARKUP_SHAPE_PATTERN =
    /<(?:!doctype\b|html\b|svg\b|script\b|style\b|iframe\b|\?xml\b|[a-z][a-z0-9-]{0,16}[\s>/])/i;

/**
 * Body-content sniffer for HTML/SVG/XML markup shape. Used by the
 * response processor when the declared `Content-Type` is
 * sniffable-for-mis-labelled-markup (plain-text-like, binary, or any
 * text/* that isn't already declared markup/markdown/JSON) — an attacker
 * controlling the response server can otherwise tamper the header byte-
 * string to disable the strip path while serving HTML body.
 *
 * Match cases (any opener within the input):
 *  - `<!doctype` / `<!DOCTYPE`
 *  - `<html`, `<svg`, `<script`, `<style`, `<iframe`
 *  - `<?xml` (XML declaration)
 *  - any `<a-z>{1,16}` opening tag with attributes (covers vendor markup
 *    like `<x-component>`, RSS/Atom roots, custom elements)
 *
 * **Scans the full input.** Earlier revisions clipped the scan to the
 * first 1 KB for cost; that was itself a bypass — an attacker padding
 * with 1 KB of benign preamble could place `<script>` past the window.
 * The processor's outer-level `STRIP_PATH_MAX_BYTES` (256 KB) gate
 * bounds the body size that reaches this sniffer, so scanning the
 * whole input is linear-time per call and bounded.
 *
 * Linear-time, ReDoS-safe (bounded `[a-z0-9-]{0,16}` + finite alternation).
 *
 * Pure: depends only on its input.
 */
export function looksLikeMarkupShape(content: string): boolean {
    return MARKUP_SHAPE_PATTERN.test(content);
}
