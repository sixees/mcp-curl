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
 * z.url() in Zod v4 accepts any WHATWG-valid URL (including javascript:, data:, ftp://).
 * The .refine() is the sole scheme enforcement at the schema layer.
 */
export function httpOnlyUrl(description: string) {
    return z.url().refine(
        (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
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
