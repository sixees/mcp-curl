// src/lib/config/security/url-schemes.ts
// Allowed URL scheme constants — single source of truth shared by the schema
// layer (`utils/url.ts`), the DNS / SSRF layer (`security/ssrf.ts`), and the
// transport layer (`execution/curl-args-builder.ts`). All three layers must
// agree on this list; defense-in-depth holds only when they do.

/**
 * Allowed URL schemes (with trailing colons, matching `URL.protocol`).
 *
 * Used by:
 * - `createHttpOnlyUrlSchema` schema validator (rejects URLs whose `.protocol` is not in this set)
 * - `validateUrlAndResolveDns` (mirrors the rejection at DNS-resolution time)
 *
 * Keep schemes in trailing-colon form (matching `URL.protocol`, e.g. `http:`).
 * `ALLOWED_URL_SCHEMES_CURL_FLAG` is derived from this list at module init,
 * so a new scheme added here is automatically picked up by the curl transport
 * layer without a second edit.
 */
export const ALLOWED_URL_SCHEMES = Object.freeze(["http:", "https:"] as const);

/**
 * Scheme allowlist as cURL's `--proto` / `--proto-redir` flag value.
 *
 * Format: `=http,https` (the leading `=` resets and replaces the default
 * scheme set; `http,https` is the comma-joined list of bare scheme names).
 * Derived deliberately at module init from `ALLOWED_URL_SCHEMES` so the two
 * representations cannot drift.
 */
export const ALLOWED_URL_SCHEMES_CURL_FLAG: `=${string}` =
    `=${ALLOWED_URL_SCHEMES.map((s) => s.replace(":", "")).join(",")}`;

/**
 * Type-narrowed predicate: does `protocol` (e.g. `URL.protocol`) appear in
 * the allowlist? Use this in place of inline `protocol === "http:" || ...`
 * checks so the constraint stays in one place.
 */
export function isAllowedUrlScheme(protocol: string): boolean {
    return (ALLOWED_URL_SCHEMES as readonly string[]).includes(protocol);
}
