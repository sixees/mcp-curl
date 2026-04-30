// src/lib/utils/content-type.ts
// Pure predicates for HTTP Content-Type values

/**
 * Strip parameters (e.g. `; charset=utf-8`) from a Content-Type and normalize.
 * Returns the lowercased, trimmed MIME type, or `""` for null/undefined input.
 *
 * Pure: depends only on its input. Single source of truth for MIME normalization
 * across the codebase — every Content-Type comparison should go through this.
 */
export function parseMimeType(contentType: string | undefined): string {
    if (!contentType) return "";
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
