// src/lib/utils/content-type.ts
// Pure predicates for HTTP Content-Type values

/**
 * Returns true for MIME types that are binary (not text).
 * Binary responses should be returned as-is without Unicode sanitization.
 *
 * Pure: depends only on its input. Safe to import anywhere.
 */
export function isBinaryContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const mime = contentType.split(";")[0].trim().toLowerCase();
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
        mime === "application/x-tar"
    );
}
