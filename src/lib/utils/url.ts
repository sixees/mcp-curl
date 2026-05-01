// src/lib/utils/url.ts
// URL resolution utilities

import { z } from "zod";

/**
 * Strip trailing slash from a base URL and prepend it to a path,
 * ensuring the path has a leading slash.
 */
export function resolveBaseUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}

/**
 * Zod schema for a URL restricted to http/https schemes.
 *
 * z.url() in Zod v4 accepts any WHATWG-valid URL (including javascript:, data:, ftp://);
 * the .refine() is the sole scheme enforcement at the schema layer. Uses the WHATWG URL
 * parser (matching how src/lib/security/ssrf.ts and Node fetch resolve URLs) so the schema
 * agrees with what the network layer will actually parse — a URL that string-splits to
 * "http:" but parses to a different scheme would otherwise pass the schema and surprise
 * the SSRF check.
 */
export function httpOnlyUrl(description: string) {
    return z.url().refine(
        (url) => {
            try {
                return ["http:", "https:"].includes(new URL(url).protocol);
            } catch {
                return false;
            }
        },
        { message: "URL must use http or https scheme" }
    ).describe(description);
}

/**
 * Extract a hostname from a URL string for use as a log label.
 * Returns the configured fallback (default: "unknown") if the URL is malformed
 * or missing — used in error paths where we still want a stable label without
 * letting URL-parse failures shadow the original error.
 *
 * Pure: depends only on its inputs.
 */
export function safeHostname(url: string | undefined, fallback = "unknown"): string {
    if (!url) return fallback;
    try {
        return new URL(url).hostname || fallback;
    } catch {
        return fallback;
    }
}
