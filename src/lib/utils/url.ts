// src/lib/utils/url.ts
// URL resolution utilities

/**
 * Strip trailing slash from a base URL and prepend it to a path,
 * ensuring the path has a leading slash.
 */
export function resolveBaseUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}
