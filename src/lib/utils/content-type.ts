// src/lib/utils/content-type.ts
// Pure predicates for HTTP Content-Type values

/**
 * Strip parameters (e.g. `; charset=utf-8`) from a Content-Type and normalize.
 * Returns the lowercased, trimmed MIME type, or `""` for null/undefined input.
 *
 * Pure: depends only on its input. Single source of truth for MIME normalization
 * across the codebase — every Content-Type comparison should go through this.
 *
 * Accepts `unknown` rather than `string | undefined` so JS callers from
 * custom-tool hooks (which bypass the TS type-system at the boundary)
 * cannot reach the `.split` call with a non-string and trigger an
 * unhelpful `TypeError`. Non-string inputs (numbers, objects, …) are
 * normalised to `""`.
 */
export function parseMimeType(contentType: unknown): string {
    if (typeof contentType !== "string" || !contentType) return "";
    return contentType.split(";")[0].trim().toLowerCase();
}

// Binary MIME domain — extracted as auditable, typed collections so new
// entries can be added without growing the conditional.
const BINARY_MIME_PREFIXES = [
    "image/",
    "audio/",
    "video/",
    "font/",
    "multipart/",
    "application/vnd.ms-",
    "application/vnd.openxmlformats-",
] as const;

// Text-readable MIME types that share a prefix with a binary family above
// (e.g. image/svg+xml is text XML, not a raster image). They must take
// precedence over the prefix match so they go through normal sanitization
// — SVG can carry <script> tags, XML comments, and bidi/zero-width chars
// the same as any other text payload.
const TEXTUAL_MIME_OVERRIDES: ReadonlySet<string> = new Set([
    "image/svg+xml",
]);

const BINARY_MIME_EXACT: ReadonlySet<string> = new Set([
    "application/octet-stream",
    "application/pdf",
    "application/wasm",
    "application/zip",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar",
    "application/x-bzip2",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/protobuf",
    "application/x-protobuf",
    "application/x-msgpack",
    "application/cbor",
    "application/msword",
]);

/**
 * Returns true for MIME types that are binary (not text).
 * Binary responses should be returned as-is without Unicode sanitization.
 *
 * Pure: depends only on its input. Safe to import anywhere.
 */
export function isBinaryContentType(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    if (!mime) return false;
    if (TEXTUAL_MIME_OVERRIDES.has(mime)) return false;
    return (
        BINARY_MIME_EXACT.has(mime) ||
        BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    );
}

// Markup MIME types whose grammar supports `<!-- ... -->` comments.
// HTML, XHTML, generic XML, and SVG all share this syntax — comments in any
// of them can hide injection content from a quick visual review of the body,
// so they must be stripped before sanitization.
const MARKUP_COMMENT_MIME_EXACT: ReadonlySet<string> = new Set([
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
    "image/svg+xml",
]);

const MARKUP_COMMENT_MIME_SUFFIXES = ["+xml"] as const;

/**
 * Returns true for MIME types whose grammar supports `<!-- ... -->` comments.
 * Used to decide whether to strip comments from the response body before
 * Unicode sanitization (so injections cannot hide inside markup comments).
 *
 * Matches:
 *  - Exact set above (text/html, application/xhtml+xml, application/xml,
 *    text/xml, image/svg+xml)
 *  - Any vendor MIME with the `+xml` structured-syntax suffix
 *    (e.g. application/atom+xml, application/rss+xml)
 *
 * Pure: depends only on its input. Safe to import anywhere.
 */
export function supportsMarkupComments(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    if (!mime) return false;
    if (MARKUP_COMMENT_MIME_EXACT.has(mime)) return true;
    return MARKUP_COMMENT_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix));
}

// Markdown MIME types — used to gate the markdown image / link beacon strip
// in the response processor. The structured-syntax suffix `+markdown` is
// rare in practice but defined by RFC 6838 so we accept it for symmetry with
// the `+xml` handling above.
const MARKDOWN_MIME_EXACT: ReadonlySet<string> = new Set([
    "text/markdown",
    "text/x-markdown",
]);

const MARKDOWN_MIME_SUFFIXES = ["+markdown"] as const;

/**
 * Returns true for MIME types whose grammar is markdown.
 *
 * Used by the response processor to decide whether to strip markdown image
 * beacons (`![alt](https://…)`) and external markdown links
 * (`[label](https://…)`). These carry the same exfiltration class as
 * `<img>`/`<a>` but bypass the HTML-tag layer because clients render them
 * directly from the markdown source.
 *
 * Matches:
 *  - `text/markdown` (RFC 7763, the canonical type)
 *  - `text/x-markdown` (legacy / pre-registration form, still in the wild)
 *  - any vendor MIME with the `+markdown` structured-syntax suffix
 *
 * Pure: depends only on its input. Safe to import anywhere.
 */
export function isMarkdownContentType(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    if (!mime) return false;
    if (MARKDOWN_MIME_EXACT.has(mime)) return true;
    return MARKDOWN_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix));
}

/**
 * Returns true when `contentType` is plain-text-shaped (`text/plain`, the
 * empty string, or undefined) — the cases where an attacker controlling
 * the response server can serve HTML-shaped bytes with a "trust me, it's
 * plain text" header to bypass the response processor's markup-strip
 * path.
 *
 * Used by the response processor in conjunction with {@link
 * looksLikeMarkupShape}: only sniff for markup when the declared type is
 * plain-text-ish, so structured types like `application/json` stay
 * un-sniffed (sniffing JSON would risk breaking valid JSON containing
 * `<script>` inside a string field).
 *
 * Pure: depends only on its input.
 */
export function isPlainTextLikeContentType(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    return mime === "" || mime === "text/plain";
}

/**
 * Lightweight markup-shape detector. Inspects the first ~1 KB of body
 * for HTML/SVG/XML opening markers. Used to sniff bodies served with a
 * non-markup `Content-Type` (or no `Content-Type`) so an attacker
 * tampering with the header byte-string can't disable the markup-strip
 * path.
 *
 * Conservative — false positives on legitimate `<` characters in plain
 * text (e.g. arithmetic comparisons) are acceptable because the
 * markup-strip is best-effort and idempotent on already-clean text.
 * Restricting to the FIRST 1 KB bounds cost on adversarial bodies and
 * means the detector cannot scan arbitrary positions for nested attack
 * markers.
 *
 * Match cases:
 *  - `<!doctype` / `<!DOCTYPE`
 *  - `<html`, `<svg`, `<script`, `<style`, `<iframe`
 *  - `<?xml` (XML declaration)
 *  - any `<a-z>{1,16}` opening tag with attributes (covers vendor markup
 *    like `<x-component>`, RSS/Atom roots, custom elements)
 *
 * Linear-time, ReDoS-safe (bounded `[a-z0-9-]{0,16}` + finite alternation).
 *
 * Pure: depends only on its input.
 */
export function looksLikeMarkupShape(content: string): boolean {
    const head = content.slice(0, 1024);
    return MARKUP_SHAPE_PATTERN.test(head);
}

// NOT exported — `i` flag, used only with `.test()` on a freshly-sliced
// 1 KB head string per call. `RegExp.prototype.test` does NOT consume
// `lastIndex` when the regex has no `g`/`y` flag (this regex has only `i`),
// so reuse across calls is safe.
const MARKUP_SHAPE_PATTERN =
    /<(?:!doctype\b|html\b|svg\b|script\b|style\b|iframe\b|\?xml\b|[a-z][a-z0-9-]{0,16}[\s>/])/i;
