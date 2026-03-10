// src/lib/config/defaults.ts
// Default User-Agent and Referer constants with resolution logic

import { SERVER } from "./server.js";

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
