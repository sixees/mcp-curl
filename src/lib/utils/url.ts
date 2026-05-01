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
 *   so a URL that string-splits to "http:" but parses to a different scheme
 *   cannot pass the schema and surprise the SSRF check.
 *
 * **Defense-in-depth, not invariant equivalence.** This helper is one of three
 * independent enforcement points (schema → DNS/SSRF → cURL `--proto`); each
 * is sufficient on its own to reject a non-http(s) request. The layers share
 * the `ALLOWED_URL_SCHEMES` allowlist, but they do not share representation —
 * for example, WHATWG canonicalises IPv4-mapped IPv6 hosts to compressed hex
 * (`[::ffff:7f00:1]`), so the SSRF blocklist must normalise that form before
 * pattern-matching against the dotted-quad rules. If a future change moves
 * one layer to a different parser or representation, the others must continue
 * to hold the line.
 *
 * Return type is pinned to `z.ZodType<string>` rather than the inferred
 * `ZodEffects<ZodURL>` so a future Zod minor that reshapes `.refine()` (or the
 * Standard Schema migration in MCP SDK 2.0, which rewrites `.refine()` to a
 * `validate()` callback) can't silently flip the public type. Callers needing
 * `.optional()` / `.default()` chainability should compose with `z.optional()`
 * at the call site.
 *
 * **Intended for module-level use only.** Each invocation registers the
 * resulting schema with Zod's `globalRegistry` (via `.describe()`); calling
 * this per-request would accumulate entries that the registry never reclaims.
 * Build the schema once at module load and reuse the reference.
 *
 * @param options - Optional configuration for the schema's caller-visible text.
 * @param options.description - Forwarded to Zod's `.describe()`. Becomes the
 *   JSON Schema `"description"` field that LLM clients render in tool input
 *   docs. Should describe what the URL is *for*; the http(s) constraint is
 *   enforced by the helper itself and shouldn't leak into every call-site
 *   description. Defaults to `"URL (http or https)"`.
 * @param options.message - Validation error message returned when the URL
 *   parses but uses a disallowed scheme. Defaults to
 *   `"URL must use http or https scheme"`.
 * @returns A Zod schema (`z.ZodType<string>`) accepting only http/https URLs.
 *   URL-format failures emit `"Must be a valid URL"`; scheme-rejection failures
 *   emit `options.message`.
 */
export function createHttpOnlyUrlSchema(
    options: CreateHttpOnlyUrlSchemaOptions = {}
): z.ZodType<string> {
    const { description = "URL (http or https)", message = "URL must use http or https scheme" } = options;
    return z.url("Must be a valid URL").refine(
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
