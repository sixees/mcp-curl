// src/lib/config/defaults.ts
// Default User-Agent and Referer constants with resolution logic

import { SERVER } from "./server.js";
import { ENV } from "./environment.js";

export const DEFAULT_USER_AGENT =
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 mcp-curl/${SERVER.VERSION}`;

export const DEFAULT_REFERER = "";

/** Resolve config value → env var → built-in default. Empty string = disabled (returns undefined). */
export function resolveDefault(
    configValue: string | undefined,
    envVar: string,
    builtInDefault: string
): string | undefined {
    if (configValue !== undefined) return configValue || undefined;
    const envValue = process.env[envVar];
    if (envValue !== undefined) return envValue || undefined;
    return builtInDefault || undefined;
}

/**
 * Apply default User-Agent and Referer to already-merged headers.
 * Uses `in` operator for key-existence checks so explicit empty strings are respected.
 *
 * @param headers - Already-merged headers (defaultHeaders + request headers)
 * @param userAgent - Existing user_agent param value (undefined if not set)
 * @param config - Optional defaultUserAgent/defaultReferer overrides
 * @returns Modified headers and resolved userAgent (separate for cURL -A flag)
 */
export function applyDefaultHeaders(
    headers: Record<string, string>,
    userAgent: string | undefined,
    config?: { defaultUserAgent?: string; defaultReferer?: string }
): { headers: Record<string, string>; userAgent: string | undefined } {
    const result = { ...headers };
    let resolvedUA = userAgent;

    if (resolvedUA === undefined && !("User-Agent" in result)) {
        resolvedUA = resolveDefault(config?.defaultUserAgent, ENV.USER_AGENT, DEFAULT_USER_AGENT);
    }

    if (!("Referer" in result)) {
        const referer = resolveDefault(config?.defaultReferer, ENV.REFERER, DEFAULT_REFERER);
        if (referer) result["Referer"] = referer;
    }

    return { headers: result, userAgent: resolvedUA };
}
