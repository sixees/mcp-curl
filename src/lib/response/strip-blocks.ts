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
 * defence. Bounds pathological cost on adversarial bodies.
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
 * Shape: `<!--[\s\S]*?(?:-->|$)` — open-to-closer-or-EOF.
 *
 * The naive `<!--[\s\S]*?-->` pattern leaves an orphan `<!--` opener in
 * inputs like `<!-- a --> <!--` (the first comment matches and removes,
 * the second has no closer so single-pass replace can't match). CodeQL's
 * "Incomplete multi-character sanitization" rule flags exactly this
 * residue. The `$` alternative absorbs unclosed openers — mirrors the
 * script/style strip pattern's open-to-EOF shape and stays linear-time.
 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;

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
 *   - Use `[^\]\n]*` (unbounded) for the alt/label portion. Earlier
 *     revisions capped at 256 chars to "defeat catastrophic backtracking"
 *     — but the negative-character class `[^\]\n]` is linear-time per
 *     attempt regardless of length (no nested quantifier, no ReDoS
 *     class). The 256-char cap was a load-bearing **bypass**: an
 *     attacker padding a label past 256 chars defeated all four enforce-
 *     ment patterns. Removing the cap closes that bypass; runaway
 *     matches are bounded by the upstream `STRIP_PATH_MAX_BYTES` cap
 *     and the `\n` exclusion (which keeps a label from spanning blocks).
 *   - Use `[^)\n]+` (unbounded) for the URL portion. Same analysis —
 *     bounded character class is linear-time; the previous 2048-char
 *     cap was the same bypass class for over-cap URLs. The `\n`
 *     exclusion bounds runaway matches across blocks; the upstream
 *     `STRIP_PATH_MAX_BYTES` cap bounds total cost.
 *   - Allow optional whitespace after the opening paren so CommonMark's
 *     `[label]( url )` shape matches.
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
    /!\[[^\]\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;
const MARKDOWN_EXTERNAL_LINK_PATTERN =
    /(?<!!)\[[^\]\n]*\]\(\s*https?:\/\/[^)\n]+\)/g;

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
    /!\[[^\]\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;
const MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN =
    /(?<!!)\[[^\]\n]*\]\(\s*(?:javascript|vbscript|file|data):[^)\n]*\)/gi;

/**
 * Residual dangerous-scheme cleanup pattern. Strips `(scheme:…)` URL
 * portions that survive the standard label-aware passes — specifically
 * the image-inside-dangerous-link nesting case
 * `[![alt](https://safe/img.png)](javascript:alert(1))`:
 *
 *   - `MARKDOWN_DANGEROUS_SCHEME_LINK_PATTERN` cannot match the OUTER
 *     because the inner `]` (closer of the `![alt]` image label) ends
 *     the outer pattern's `[^\]\n]` label class before reaching the
 *     outer `)`.
 *   - `MARKDOWN_EXTERNAL_IMAGE_PATTERN` THEN replaces the inner image
 *     with `[image removed]`, leaving residue `[[image removed]](javascript:...)`.
 *   - `MARKDOWN_EXTERNAL_LINK_PATTERN` doesn't match — URL is `javascript:`,
 *     not http(s).
 *
 * After-pass: lookbehind `(?<=\])` requires the URL to be preceded by a
 * `]` (i.e., it MUST sit at a markdown-link boundary), bounding false-
 * positive risk on legitimate prose mentioning `(javascript:foo)`. The
 * URL char class `[^)\n]{0,4096}` mirrors the standard pattern bounds.
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
        const next = decoded.replace(SCRIPT_BLOCK_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
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
