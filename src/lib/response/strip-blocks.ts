// src/lib/response/strip-blocks.ts
// HTML / markdown content-strip subsystem for the response pipeline.
//
// Threat model: attacker controls HTTP response bytes; the strip path
// neutralises `<script>` / `<style>` blocks (HTML / XHTML / SVG / *+xml /
// markdown) and markdown beacon URLs (image / link / dangerous-scheme).
// The caller sequences these: `processor.ts::defendText` sanitises and
// detects FIRST (Step 2, so padding cannot inflate a body past the cap
// below), strips here (Steps 3-4), then sanitises and detects again (Step 5)
// because removing markup can join a phrase it separated.
//
// Cost is bounded by the patterns, not by the 256 KB cap: a `g`-flagged
// replace starts a match attempt at every position, so a failing attempt
// that can scan forward without limit is quadratic however small the input
// is (ARCHITECTURE.md invariant 15). The cap is a circuit-breaker, not what
// makes this path linear, and nothing here iterates: the tag and comment
// strips converge by scanning the output tail.
//
// **Best-effort textual sanitisation, not a full HTML sandbox.** We
// considered `parse5` (zero false positives, no ReDoS class) but rejected
// it: 60 KB minified, 2× slower on small bodies, adds a runtime dep.
// Acceptable for our threat model — content reaches an LLM, not a
// renderer.

/**
 * Replacement strings written by `stripMarkdownBeacons` over removed
 * markdown URL surfaces. Exported so tests can import the source of
 * truth instead of duplicating the literal strings.
 */
export const IMAGE_REMOVED_PLACEHOLDER = "[image removed]";
/** @see IMAGE_REMOVED_PLACEHOLDER */
export const LINK_REMOVED_PLACEHOLDER = "[link removed]";

/**
 * 256 KB cap for the HTML-block-strip path. Above the cap the strip stages
 * are skipped entirely and the caller's `sanitizeAndDetect` is the only
 * defence.
 *
 * **It caps the input, not the cost.** A quadratic pattern is still
 * quadratic below the cap — at 256 KB a quadratic form of these patterns
 * took 82 seconds (invariant 15). Linearity is the patterns' job; this is a
 * size policy.
 *
 * The pipeline orders sanitise BEFORE strip so visible-space-padding
 * inflation can't push the strip target above this cap.
 *
 * **Deliberately smaller than `LIMITS.DEFAULT_MAX_RESULT_SIZE` (500 KB).**
 * Non-JSON text between the two is returned inline without strip-pass
 * processing — defence-in-depth, not a sandbox. The sanitiser has no size
 * cap and runs on the full text of every non-JSON part; a JSON document is
 * detected on and never rewritten, at any size. The strip cap is therefore
 * a circuit-breaker, not a content-size policy.
 *
 * **Exported `@internal`** so the caller (`processor.ts::defendText`) can
 * gate the whole strip path (Steps 3-5) on one cap. None of the passes in
 * this file checks it itself, so that gate is the only one.
 */
export const STRIP_PATH_MAX_BYTES = 256 * 1024;

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
 * Shape: `<tag\b[^<>]*>[\s\S]*?</\s*tag\b[^<>]*>`
 *
 * - **Body** uses lazy `[\s\S]*?` rather than a negative-lookahead
 *   `(?:(?!<\/?tag\b)[\s\S])*?` — each lazy expansion does an O(1) check of
 *   the closer, and the lookahead form leaves a `<script>` orphan in the
 *   residue of a self-healing payload.
 * - **Closer** allows whitespace-or-newline between `</` and `tag` (`\s*`
 *   absorbs `</ script>`, `</\nscript>`), accepts attributes after the
 *   tag name, and is case-insensitive (`i` flag).
 * - **BOTH attribute runs are `[^<>]*`, never `[^>]*`, and each half guards
 *   its own quadratic.** On the closer, a run that swallows `<` swallows the
 *   OPENERS after it, which leaves
 *   `"</script " + "<script".repeat(35000) + ">"` quadratic at 9 s. On the
 *   opener, a run that crosses `<` reaches the CLOSER's own `>` and consumes
 *   it as the opening tag's terminator — so `"<script".repeat(30000) +
 *   "</script>"` puts every opener in a region whose only closer it has just
 *   eaten, and each then scans to end-of-input looking for a second one:
 *   2881 ms measured. Fixing either side alone leaves its mirror open
 *   (`.claude/rules/01-known-shapes.md` K-11).
 *
 *   **What excluding `<` costs, stated rather than buried:** a literal `<`
 *   inside a quoted attribute value is legal HTML and stops the BALANCED
 *   match, so `<script foo="a<b">alert(1)</script>` keeps `alert(1)` as inert
 *   text. Both tags still go, via {@link stripTagTokens} — the RC-11 posture,
 *   the same on opener and closer.
 * - **Word boundary** `\b` after the tag name avoids matching
 *   `<scriptlike>` / `<stylesheet>` etc.
 *
 * **Unclosed forms are NOT handled here.** An open-to-end-of-input `|$)` arm
 * would delete the rest of the payload on any orphan opener, so orphans are
 * {@link stripTagTokens}'s job. Between the two, no `<script` / `</script` /
 * `<style` / `</style` token survives a pass. `LESSONS.md` RC-11.
 *
 * **Linear per match is not linear per pass.** Each lazy expansion costs O(1),
 * so one match attempt is linear — but a `g`-flagged replace starts an attempt
 * at every position, so O(n) failing attempts of O(n) each is O(n²). The
 * 256 KB cap does not rescue that: at the cap and without the region bound,
 * these patterns measured 4.5 s and the markdown patterns below 82 s.
 *
 * Cost is bounded by construction instead — see {@link withinClosableRegion},
 * which every pass in this file goes through. **The bound keys on each
 * pattern's own closing token, never on the last `>`**: `</script>` needs the
 * tag name, not an angle bracket, so a `>`-keyed bound keeps
 * `"<script>".repeat(32000)` wholly in scope at 1.1 s. `LESSONS.md` RC-11.
 *
 * **The region bound is necessary and it is not sufficient.** Being inside the
 * region only guarantees a closer lies AHEAD; it
 * says nothing about whether the attempt can reach it without eating it first.
 * The character classes are what carry that, so the two are one mechanism and a
 * change to either has to be argued against both.
 */
const SCRIPT_BLOCK_PATTERN =
    /<script\b[^<>]*>[\s\S]*?<\/\s*script\b[^<>]*>/gi;
const STYLE_BLOCK_PATTERN =
    /<style\b[^<>]*>[\s\S]*?<\/\s*style\b[^<>]*>/gi;

/**
 * Markdown image / link beacon patterns. Both:
 *   - Use `[^\]\[\n]*` (unbounded) for the alt/label portion. Neither `]`
 *     nor `[` may appear in a label. `]` is the label's terminator; `[` is
 *     excluded so a failing attempt cannot scan forward from every `[` in the
 *     body — 256 KB of `[` measured 82 seconds, synchronously.
 *
 *     **That exclusion is not on its own what makes the pass linear.** It
 *     bounds the LABEL; the URL class `[^)\n]+` is free to scan to
 *     end-of-input, so `"[a](https://x".repeat(19000)` takes 2.9 s on the
 *     exclusion alone. Linearity comes from the `)` bound in
 *     `stripMarkdownBeacons` (ARCHITECTURE.md invariant 15).
 *
 *     **Known cost of the `[` exclusion:** a CommonMark-legal label that
 *     itself contains brackets — `[see [1]](https://host/x)` — matches none
 *     of the four patterns and its URL is returned intact. The `]` exclusion
 *     alone already breaks it, and it is declined rather than fixed:
 *     the population `LESSONS.md` RC-47 measured has no attacker choosing
 *     these bytes, and a terminal client fetches no URL unprompted. A fix
 *     must not restore an unbounded forward scan.
 *
 *     A length cap on the label is the wrong instrument for both jobs:
 *     capping it at 256 chars to "defeat catastrophic backtracking" is a
 *     load-bearing **bypass** — padding a label past the cap defeats all
 *     four patterns — and does not bound cost either. The character class
 *     is the right one.
 *   - Use `[^)\n]+` (unbounded) for the URL portion. Same reasoning: a
 *     2048-char cap is the same bypass class for over-cap URLs, and `)`
 *     terminates the scan.
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
 *     because the inner `[` of `![alt]` ends the outer pattern's
 *     `[^\]\[\n]` label class before reaching the outer `)`.
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
 * **Sound as a bound on the REGION, and that is all it is.** No match can BEGIN
 * after the last closer, because every match contains one — so text beyond it
 * cannot hold any part of a match and skipping it changes no output. That makes
 * this a bound rather than a cap: `STRIP_PATH_MAX_BYTES` limits the input, this
 * limits the search to where an answer could be.
 *
 * **It does not on its own make an attempt succeed, and reading it that way is
 * the mistake to avoid.** A closer ahead is not a closer
 * the attempt can REACH: with the opener written `[^>]*`, an attribute run
 * crossing `<` ate the region's only closer as its own terminator, and
 * `"<script".repeat(30000) + "</script>"` took 2881 ms inside a correctly
 * computed bound (`LESSONS.md` RC-14). **The character classes are the other
 * half of this mechanism** — each must exclude the first character of the token
 * the match has to reach. Neither half is sufficient; change either and argue
 * it against both.
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
 * original, misaligning every check in {@link lastTagCloserEnd} after any such
 * character — on `İ<script>…</script>` the balanced pass would be skipped
 * entirely.
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
 * Three properties are load-bearing, and each has a measured failure:
 *
 * 1. **A bare `>` is not this token.** `</script>` needs the tag name, so
 *    `"<script>".repeat(32000)` — every character before a `>` — left the whole
 *    input in scope and each opener scanned to end-of-input: 1.1 s measured.
 * 2. **The name needs the same `\b` the pattern requires.** `</scripture>` is
 *    not a script closer, and accepting it as one put
 *    `"<script></scripture>".repeat(13000)` back in scope at 1.9 s.
 * 3. **The attribute run may not contain `<`.** A closer whose `[^>]*` suffix
 *    spans openers puts them inside the bound with no closer of their own
 *    after them — `"</script " + "<script".repeat(35000) + ">"` measured 9 s.
 *    This walk, the pattern's closer and the pattern's opener are therefore
 *    all `[^<>]*`, and the three have to agree: a run on the opener that
 *    crosses `<` eats the closer's `>`.
 *    A tag either class rejects still loses both its tags to
 *    {@link stripTagTokens}, so what the exclusion costs is a surviving
 *    body, never a surviving tag.
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
 * Strip `<script>` / `<style>` blocks and every remaining tag of either name.
 *
 * Two balanced `replace` passes, each bounded at its own closing token, then
 * {@link stripTagTokens} over the whole string. One call is the whole strip:
 * nothing here iterates, and neither does the caller.
 *
 * **The order is what makes the balanced passes safe.** They can splice — a
 * removal rejoins its neighbours, so `<scr<script>x</script>ipt>` becomes
 * `<script>` — and the scan that follows is unconditional and covers the whole
 * string, so any token they leave behind is removed. CodeQL flags both replaces
 * for that residue; the decline stands on this ordering, and NOT on an
 * iteration cap, which an attacker outruns by nesting one layer deeper than
 * the cap (`LESSONS.md` RC-13).
 * A seeded fuzz over the token alphabet asserts the property directly.
 */
export function stripScriptStyleBlocks(text: string): string {
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
 * and a `replace` exposes exactly ONE layer per pass. Wrapping it in a bounded
 * loop does not converge: it moves the surviving depth to the bound, and an
 * attacker picks the depth.
 * `"<scr".repeat(4) + "<script>" + "ipt>".repeat(4)` returns a live
 * `<script>` from such a loop.
 *
 * **"A loop handles the splice" is the argument to refuse here.** CodeQL's
 * incomplete multi-character sanitisation rule reports exactly this residue,
 * and the loop answer is true only below its cap — the part the rule points
 * at. `LESSONS.md` RC-13.
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
 * **A single left-to-right scan, and deliberately not a regex.** The regex
 * form has two defects and neither has a fix at that layer:
 *
 * - **Cost.** `<!--[\s\S]*?-->` scans to end-of-input from every opener that
 *   has no closer ahead: `"<!--".repeat(65536)` takes 5.5 s.
 * - **Splicing.** Deleting a literal can form a new one out of its neighbours —
 *   `<!<!----` loses the inner `<!--` and the surviving `<!` and `--` join into
 *   a fresh opener. Iterating a `replace` only pushes that out by one layer per
 *   pass, so a four-iteration loop over `"<!".repeat(5) + "--".repeat(5)` still
 *   returns a live `<!--`. CodeQL's incomplete multi-character sanitisation
 *   rule reports this shape.
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
