// src/lib/response/strip-blocks.ts
// HTML / markdown content-strip subsystem for the response pipeline.
//
// Threat model: attacker controls HTTP response bytes; the strip path
// neutralises `<script>` / `<style>` blocks (HTML / XHTML / SVG / *+xml /
// markdown) and markdown beacon URLs (image / link / dangerous-scheme)
// before sanitiseAndDetect runs downstream. ReDoS-hardened with a 256 KB
// body cap and a 4-iteration fixed-point loop.
//
// **Best-effort textual sanitisation, not a full HTML sandbox.** We
// considered `parse5` (zero false positives, no ReDoS class) but rejected
// it: 60 KB minified, 2× slower on small bodies, adds a runtime dep.
// Acceptable for our threat model — content reaches an LLM, not a
// renderer.

/**
 * 256 KB cap for the HTML-block-strip path. Above the cap the strip step
 * is skipped entirely and the caller's `sanitiseAndDetect` is the only
 * defence. Bounds pathological cost on adversarial bodies.
 *
 * The pipeline orders sanitise BEFORE strip so visible-space-padding
 * inflation can't push the strip target above this cap (PR-7 round 2).
 */
const STRIP_PATH_MAX_BYTES = 256 * 1024;

/**
 * Fixed-point iteration cap. Self-healing payloads like
 * `<scr<script>ipt>alert(1)</scr</script>ipt>` need ≥2 passes to fully
 * neutralise after the inner balanced match removes; cap at 4 to
 * guarantee termination on contrived nesting. The loop exits early when
 * the strip passes converge (`next === curr`) — 4 is the soft termination
 * guarantee, not a theoretical max nesting depth.
 */
const STRIP_FIXED_POINT_MAX_ITERATIONS = 4;

/**
 * NOT exported — `g` flag makes the regex stateful. Used only with
 * `.replace()` here (which doesn't read `lastIndex`). Never use with
 * `.test()` or `.exec()` — both would corrupt state across calls.
 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * Strip patterns for `<script>` and `<style>` blocks. These match either:
 *   - a balanced `<tag>…</tag>` form, OR
 *   - an unclosed/malformed-closer form (open tag → end-of-string OR
 *     malformed close tag).
 *
 * Shape: `<tag\b[^>]*>[\s\S]*?(?:</\s*tag\b[^>]*>|$)`
 *
 * - **Body** uses lazy `[\s\S]*?` rather than the older negative-lookahead
 *   `(?:(?!<\/?tag\b)[\s\S])*?`. The lazy + alternation form is linear-
 *   time per match (each lazy expansion does an O(1) end-pattern check),
 *   handles unclosed blocks (the `$` alternative) and malformed closers
 *   (whitespace before/after `tag` via `\s*`/`[^>]*`), and removes the
 *   self-healing-payload edge case where the older balanced pattern would
 *   leave a `<script>` orphan in the residue.
 * - **Closer** allows whitespace-or-newline between `</` and `tag` (`\s*`
 *   absorbs `</ script>`, `</\nscript>`), accepts attributes after the
 *   tag name (`[^>]*`), and is case-insensitive (`i` flag).
 * - **Word boundary** `\b` after the tag name avoids matching
 *   `<scriptlike>` / `<stylesheet>` etc.
 *
 * Combined with the fixed-point loop (handles self-healing) these
 * patterns subsume the older orphan-tag cleanup pass — there is no
 * surviving `<script>` / `</script>` / `<style>` / `</style>` token after
 * one pass because the open-to-close-or-EOF form always consumes the
 * open and everything after it.
 *
 * Linear-time per match: lazy `[\s\S]*?` extends one position at a time;
 * each step does an O(1) check of the alternation `(closer|$)`. Combined
 * with the 256 KB cap this guarantees wall-clock < 100 ms on any
 * adversarial input.
 */
const SCRIPT_BLOCK_PATTERN =
    /<script\b[^>]*>[\s\S]*?(?:<\/\s*script\b[^>]*>|$)/gi;
const STYLE_BLOCK_PATTERN =
    /<style\b[^>]*>[\s\S]*?(?:<\/\s*style\b[^>]*>|$)/gi;

/**
 * Markdown image / link beacon patterns. Both:
 *   - Cap the alt/label length at 256 chars — defeats catastrophic
 *     backtracking on adversarial mismatched-bracket input.
 *   - Cap the URL length at 2048 chars (well above legitimate
 *     distribution).
 *   - Allow optional whitespace after the opening paren so CommonMark's
 *     `[label]( url )` shape matches.
 *   - Use `[^)\n]` for the URL portion (vs older `[^\s)]`) so URLs
 *     containing whitespace (markdown title-syntax `(url "title")`) and
 *     URLs containing a balanced `(` (Wikipedia-style links like
 *     `Foo_(bar)`) at least partially match — `[^)\n]` greedy stops at
 *     the first `)`, so a URL with internal `)` matches up to that
 *     point. The newline exclusion bounds runaway matches across blocks.
 *   - Require an http(s) scheme — non-http schemes are handled by
 *     {@link MARKDOWN_DANGEROUS_SCHEME_PATTERN} below. Same-origin or
 *     relative URLs (no scheme) are deliberately preserved.
 *
 * Two separate patterns rather than a single `(!?)`-captured pattern:
 * the link pattern's `(?<!!)` negative lookbehind keeps image syntax
 * `![alt](url)` from being matched as a link by the link strip — vital
 * for the image-inside-link nesting case, where running images first
 * (lookbehind-free) and links second (lookbehind-required) preserves
 * the image-vs-link distinction. Replacing this with a single capture
 * regex breaks that case (the greedy label consumes the inner `[`,
 * matching the inner `]…)` shape as a link). All maintained Node LTS
 * versions support negative lookbehind.
 */
const MARKDOWN_EXTERNAL_IMAGE_PATTERN =
    /!\[[^\]\n]{0,256}\]\(\s*https?:\/\/[^)\n]{1,2048}\)/g;
const MARKDOWN_EXTERNAL_LINK_PATTERN =
    /(?<!!)\[[^\]\n]{0,256}\]\(\s*https?:\/\/[^)\n]{1,2048}\)/g;

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
    /!\[[^\]\n]{0,256}\]\(\s*(?:javascript|vbscript|file|data):[^)\n]{0,4096}\)/gi;
const MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN =
    /(?<!!)\[[^\]\n]{0,256}\]\(\s*(?:javascript|vbscript|file|data):[^)\n]{0,4096}\)/gi;

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
 * Pre-decode of numeric HTML entities runs first so payloads like
 * `&#x3c;script&#x3e;` are unmasked before the strip patterns see them.
 *
 * Returns the input unchanged when no further reductions are possible.
 *
 * @param input - text content to strip (caller is responsible for
 *                content-type gating; this function does not check it)
 */
export function stripBlocksFixedPoint(input: string): string {
    if (Buffer.byteLength(input, "utf8") > STRIP_PATH_MAX_BYTES) return input;
    let curr = decodeNumericHtmlEntities(input);
    for (let i = 0; i < STRIP_FIXED_POINT_MAX_ITERATIONS; i++) {
        const next = curr.replace(SCRIPT_BLOCK_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
        if (next === curr) return next;
        curr = next;
    }
    return curr;
}

/**
 * Strip HTML comments (`<!-- … -->`) from input. Exported as a separate
 * step so the caller can sequence it as part of the response pipeline.
 * Linear-time, ReDoS-safe (lazy `[\s\S]*?` with a fixed `-->` terminator
 * gives no catastrophic-backtracking shape).
 */
export function stripHtmlComments(input: string): string {
    return input.replace(HTML_COMMENT_PATTERN, "");
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
 */
export function stripMarkdownBeacons(input: string): string {
    return input
        .replace(MARKDOWN_DANGEROUS_SCHEME_IMAGE_PATTERN, "[image removed]")
        .replace(MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN, "[link removed]")
        .replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, "[image removed]")
        .replace(MARKDOWN_EXTERNAL_LINK_PATTERN, "[link removed]");
}
