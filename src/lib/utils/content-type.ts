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
        mime.startsWith("image/") ||
        mime.startsWith("audio/") ||
        mime.startsWith("video/") ||
        mime.startsWith("font/") ||
        mime.startsWith("multipart/") ||
        mime === "application/octet-stream" ||
        mime === "application/pdf" ||
        mime === "application/wasm" ||
        mime === "application/zip" ||
        mime === "application/gzip" ||
        mime === "application/x-gzip" ||
        mime === "application/x-tar" ||
        mime === "application/x-bzip2" ||
        mime === "application/x-7z-compressed" ||
        mime === "application/x-rar-compressed" ||
        mime === "application/protobuf" ||
        mime === "application/x-protobuf" ||
        mime === "application/x-msgpack" ||
        mime === "application/cbor" ||
        mime === "application/msword" ||
        mime.startsWith("application/vnd.ms-") ||
        mime.startsWith("application/vnd.openxmlformats-")
    );
}
