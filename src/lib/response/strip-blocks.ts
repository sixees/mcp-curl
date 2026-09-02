// src/lib/response/strip-blocks.ts
// HTML / markdown content-strip subsystem for the response pipeline.
//
// Threat model: attacker controls HTTP response bytes; the strip path
// neutralises `<script>` / `<style>` blocks (HTML / XHTML / SVG / *+xml /
// markdown) and markdown beacon URLs (image / link / dangerous-scheme)
// before sanitiseAndDetect runs downstream.
//
// Cost is bounded by the patterns, not by the 256 KB cap: a `g`-flagged
// replace starts a match attempt at every position, so a failing attempt
// that can scan forward without limit is quadratic however small the input
// is (ARCHITECTURE.md invariant 15). The cap is a circuit-breaker and the
// 4-iteration fixed-point loop is a termination guarantee; neither is what
// makes this path linear.
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
 * Fixed-point iteration cap. Self-healing payloads like
 * `<scr<script>ipt>alert(1)</scr</script>ipt>` need ≥2 passes to fully
 * neutralise after the inner balanced match removes; cap at 4 to
 * guarantee termination on contrived nesting. The loop exits early when
 * the strip passes converge (`next === curr`) — 4 is the soft termination
 * guarantee, not a theoretical max nesting depth.
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
 * Strip HTML comments.
 *
 * `g` flag — see safety contract above. Used only with `.replace()`.
 *
 * Shape: balanced `<!--[\s\S]*?-->`, plus a separate literal sweep for an
 * orphan `<!--` token.
 *
 * The naive balanced pattern alone leaves an orphan `<!--` opener in inputs
 * like `<!-- a --> <!--` (the first comment matches and removes, the second
 * has no closer so single-pass replace can't match). CodeQL's "Incomplete
 * multi-character sanitization" rule flags exactly that residue, and an
 * earlier revision absorbed it with an `|$)` alternative — open-to-EOF.
 *
 * **That alternative deleted the remainder of the input**, and on a channel
 * this library is only a courier for that is silent, unrecoverable data loss:
 * one unclosed `<!--` in a custom tool's HTML turned `before <!-- x\nafter`
 * into `before `, with no marker, no `isError` and no observable length delta.
 * Removing the OPENER TOKEN satisfies CodeQL's residue rule just as well — the
 * token a renderer would honour is gone — without deleting text the caller
 * asked for. See `LESSONS.md` RC-11.
 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * Orphan `<!--` with no closer. A literal, so the sweep is O(n) with no
 * forward scan — which is also why it can run over the whole input while the
 * block patterns below are bounded.
 */
const HTML_COMMENT_ORPHAN_PATTERN = /<!--/g;

/**
 * Strip patterns for BALANCED `<script>` / `<style>` blocks.
 *
 * Shape: `<tag\b[^>]*>[\s\S]*?</\s*tag\b[^>]*>`
 *
 * - **Body** uses lazy `[\s\S]*?` rather than the older negative-lookahead
 *   `(?:(?!<\/?tag\b)[\s\S])*?` — each lazy expansion does an O(1) check of
 *   the closer, and it removes the self-healing-payload edge case where the
 *   older form left a `<script>` orphan in the residue.
 * - **Closer** allows whitespace-or-newline between `</` and `tag` (`\s*`
 *   absorbs `</ script>`, `</\nscript>`), accepts attributes after the
 *   tag name (`[^>]*`), and is case-insensitive (`i` flag).
 * - **Word boundary** `\b` after the tag name avoids matching
 *   `<scriptlike>` / `<stylesheet>` etc.
 *
 * **Unclosed forms are NOT handled here.** These patterns carried an `|$)`
 * open-to-end-of-input arm until 3.4.0; it deleted the rest of the payload on
 * any orphan opener, so it was replaced by the orphan-tag sweep below. Between
 * the two, no `<script` / `</script` / `<style` / `</style` token survives a
 * pass — the property the `|$)` arm was actually carrying. `LESSONS.md` RC-11.
 *
 * **Linear per match is not linear per pass.** Each lazy expansion costs O(1),
 * so one match attempt is linear — but a `g`-flagged replace starts an attempt
 * at every position, so O(n) failing attempts of O(n) each is O(n²). An earlier
 * revision of this comment reasoned from the per-match property to "the 256 KB
 * cap guarantees wall-clock < 100 ms on any adversarial input"; that was wrong
 * by roughly 800× (4.5 s here, 82 s for the markdown patterns below).
 * Cost is bounded by construction instead: `[^>]*` can only scan within the
 * region a `>` closes (see `stripTagBlocks`), so a failing attempt cannot walk
 * to end-of-input. Same input, same patterns: 0.1 ms. `LESSONS.md` RC-11.
 */
const SCRIPT_BLOCK_PATTERN =
    /<script\b[^>]*>[\s\S]*?<\/\s*script\b[^>]*>/gi;
const STYLE_BLOCK_PATTERN =
    /<style\b[^>]*>[\s\S]*?<\/\s*style\b[^>]*>/gi;

/**
 * Orphan `<script>` / `<style>` tags — an opener with no closer, or a closer
 * with no opener. Removing the TAG leaves its body as inert text instead of
 * deleting to end of input.
 *
 * Both halves are required: an orphan opener is what a renderer would honour,
 * and an orphan closer is the residue CodeQL's incomplete-sanitisation rule
 * flags. Between them no `<script` / `</script` / `<style` / `</style` token
 * survives a pass, which is the property the old `|$)` arm was carrying.
 */
const SCRIPT_ORPHAN_TAG_PATTERN = /<\/?\s*script\b[^>]*>/gi;
const STYLE_ORPHAN_TAG_PATTERN = /<\/?\s*style\b[^>]*>/gi;

/**
 * Markdown image / link beacon patterns. Both:
 *   - Use `[^\]\[\n]*` (unbounded) for the alt/label portion. Neither `]`
 *     nor `[` may appear in a label, and both exclusions are load-bearing:
 *     `]` because it is the label's terminator, and **`[` because it is what
 *     keeps the pattern linear.** Without it a failing attempt scans forward
 *     to end-of-input from every `[` in the body — 256 KB of `[` measured
 *     82 seconds, synchronously (ARCHITECTURE.md invariant 15).
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
 * Strip `<script>` and `<style>` blocks (tag + content) with fixed-point
 * iteration so self-healing payloads cannot reconstruct around an inner
 * removal. Bodies above {@link STRIP_PATH_MAX_BYTES} skip the strip path
 * entirely — the caller's sanitiser is the only defence above the cap.
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
 * One pass of the script/style strip, bounded to the region where a tag can
 * actually close.
 *
 * **Why the bound is needed.** Every pattern here ends at a literal `>`, and
 * `[^>]*` scans forward to find one. On input with no `>` after an opener each
 * attempt scans to end-of-input and fails — and with a `g`-flagged replace the
 * start positions are themselves O(n), so the pass is O(n²). Measured on the
 * old patterns: 256 KB of `<script` with no `>` took 4.5 seconds, synchronously,
 * on the thread serving every session.
 *
 * **Why the bound is sound.** No match can begin after the last `>`: the opener
 * needs one, the balanced closer needs one, and the orphan-tag sweep needs one.
 * So text beyond it cannot contain any part of a match, and skipping it is
 * exactly equivalent rather than an approximation. That equivalence is what
 * makes this a bound and not a cap — `STRIP_PATH_MAX_BYTES` limits the input,
 * this limits the search to where an answer could be.
 *
 * The removal of the old `|$)` open-to-EOF arm (`LESSONS.md` RC-11) is what
 * makes it true. With that arm a match could begin before the last `>` and run
 * past it to end-of-input, so the tail was reachable and could not be skipped.
 */
function stripTagBlocks(text: string): string {
    const lastGt = text.lastIndexOf(">");
    if (lastGt === -1) return text;
    const head = text
        .slice(0, lastGt + 1)
        .replace(SCRIPT_BLOCK_PATTERN, "")
        .replace(STYLE_BLOCK_PATTERN, "")
        .replace(SCRIPT_ORPHAN_TAG_PATTERN, "")
        .replace(STYLE_ORPHAN_TAG_PATTERN, "");
    return head + text.slice(lastGt + 1);
}

/**
 * Strip HTML comments (`<!-- … -->`) from input. Exported as a separate
 * step so the caller can sequence it as part of the response pipeline.
 *
 * Two passes: balanced comments are removed whole, then any orphan `<!--`
 * token is removed on its own, leaving the text after it intact. Both are
 * linear — the balanced pattern's lazy body ends at a fixed `-->`, and the
 * orphan sweep is a literal.
 */
export function stripHtmlComments(input: string): string {
    return input
        .replace(HTML_COMMENT_PATTERN, "")
        .replace(HTML_COMMENT_ORPHAN_PATTERN, "");
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
    return input
        .replace(MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER)
        .replace(MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER)
        .replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, IMAGE_REMOVED_PLACEHOLDER)
        .replace(MARKDOWN_EXTERNAL_LINK_PATTERN, LINK_REMOVED_PLACEHOLDER)
        .replace(MARKDOWN_DANGEROUS_SCHEME_RESIDUAL_PATTERN, "");
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
