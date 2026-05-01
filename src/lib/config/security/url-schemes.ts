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
 * Adding a scheme here without also updating `ALLOWED_URL_SCHEMES_CURL_FLAG`
 * silently disables the new scheme at the curl transport layer.
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
