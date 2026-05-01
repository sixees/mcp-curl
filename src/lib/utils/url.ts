// src/lib/utils/url.ts
// URL resolution utilities

import { z } from "zod";
import { isAllowedUrlScheme } from "../config/security/url-schemes.js";

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
 * Options for `createHttpOnlyUrlSchema`.
 */
export interface CreateHttpOnlyUrlSchemaOptions {
    /**
     * Caller-facing description registered with Zod's `.describe()`. Surfaced to
     * MCP clients via `globalRegistry`, so phrase it in terms of *what the URL
     * is for* (e.g. "Base URL of the API"), not in terms of the scheme rule —
     * the scheme rule is enforced by this helper and shouldn't leak into every
     * call-site description.
     */
    description?: string;
    /**
     * Custom validation error message returned when the URL parses but uses a
     * disallowed scheme. Defaults to "URL must use http or https scheme".
     */
    message?: string;
}

/**
 * Create a Zod schema for a URL restricted to the http/https allowlist.
 *
 * Strict HTTP/HTTPS-only by design — the allowlist is the single source of
 * truth in `config/security/url-schemes.ts`, shared with the DNS layer
 * (`security/ssrf.ts`) and the cURL transport (`execution/curl-args-builder.ts`).
 * **Do not relax this helper to add `mailto:`, `data:`, etc. under pressure.**
 * If a different allowlist is ever needed, add a separate
 * `createUrlSchemaWithSchemes(allowedSchemes, options)` factory rather than
 * widening the strict default — defence-in-depth across three layers depends
 * on this list staying narrow.
 *
 * Validation logic:
 * - `z.url()` accepts any WHATWG-valid URL (including `javascript:`, `data:`,
 *   `ftp://`); the `.refine()` is the sole scheme enforcement at the schema
 *   layer.
 * - Uses the WHATWG URL parser (matching `security/ssrf.ts` and Node fetch),
 *   so the schema agrees with what the network layer will actually parse — a
 *   URL that string-splits to "http:" but parses to a different scheme would
 *   otherwise pass the schema and surprise the SSRF check.
 *
 * Return type is pinned to `z.ZodType<string>` rather than the inferred
 * `ZodEffects<ZodURL>` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * @param options - Optional `description` (default: "URL (http or https)") and `message`.
 * @returns A Zod schema validating a string is an http/https URL.
 */
export function createHttpOnlyUrlSchema(
    options: CreateHttpOnlyUrlSchemaOptions = {}
): z.ZodType<string> {
    const { description = "URL (http or https)", message = "URL must use http or https scheme" } = options;
    return z.url().refine(
        (url) => {
            try {
                return isAllowedUrlScheme(new URL(url).protocol);
            } catch {
                return false;
            }
        },
        { message }
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
