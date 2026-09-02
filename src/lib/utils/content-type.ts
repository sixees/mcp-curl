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
/**
 * The canonical markdown MIME type.
 *
 * Exported so a caller that needs to *declare* markdown — rather than detect it
 * — references the same string the predicates match against, instead of a bare
 * literal the compiler cannot check. A typo in such a literal silently disables
 * the markdown strip stages.
 */
export const MARKDOWN_MIME = "text/markdown" as const;

/**
 * The canonical JSON MIME type.
 *
 * Exported for the mirror of {@link MARKDOWN_MIME}'s reason. A caller that needs
 * to *declare* JSON — `jq_query`, whose content is JSON by construction —
 * references the string the predicates match against rather than a bare literal.
 * The failure a typo causes points the other way here: a misspelt value stops
 * matching `isSniffableContentType`'s JSON arm, the strip path switches on, and
 * the markup stages rewrite legitimate `<script>` and `[a](b)` inside JSON
 * string values.
 */
export const JSON_MIME = "application/json" as const;

const MARKDOWN_MIME_EXACT: ReadonlySet<string> = new Set([
    MARKDOWN_MIME,
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
 * Returns `true` when `contentType` is a candidate for body-content
 * sniffing in the response-processor's markup-strip path. The strip
 * subsystem's body-content sniffer (`response/strip-blocks.ts →
 * looksLikeMarkupShape`) is only consulted when the declared CT does
 * NOT already commit to a structured grammar we'd handle either way:
 *
 *   - **Returns `true`** for: empty / undefined CT; `text/plain`; any
 *     other `text/*` subtype that ISN'T already declared markup
 *     (`text/html`) or markdown (`text/markdown`, `text/x-markdown`);
 *     and any binary CT (`image/*`, `application/octet-stream`, …).
 *     Attackers tamper with Content-Type to disable the strip path; if
 *     the declared shape is non-markup AND the body looks like markup,
 *     the strip should still fire.
 *   - **Returns `false`** for: declared markup/markdown (already strip-
 *     handled without the sniffer) and `application/json` (legitimate
 *     JSON can contain `<script>` inside a string field, so sniffing
 *     would mangle the document).
 *
 * Pure: depends only on its input. Replaces an earlier
 * `isPlainTextLikeContentType` predicate that returned true ONLY for
 * `text/plain` / empty — that narrower predicate let `text/csv`,
 * `text/javascript`, `application/yaml` etc. silently bypass the strip.
 */
export function isSniffableContentType(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    if (mime === JSON_MIME) return false;
    if (MARKUP_COMMENT_MIME_EXACT.has(mime)) return false;
    if (MARKUP_COMMENT_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix))) return false;
    if (MARKDOWN_MIME_EXACT.has(mime)) return false;
    if (MARKDOWN_MIME_SUFFIXES.some((suffix) => mime.endsWith(suffix))) return false;
    if (mime === "" || mime === "text/plain") return true;
    if (mime.startsWith("text/")) return true;
    return isBinaryContentType(contentType);
}
