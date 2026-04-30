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
    return (
        BINARY_MIME_EXACT.has(mime) ||
        BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    );
}
