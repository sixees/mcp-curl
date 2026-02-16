// src/lib/security/ssrf.ts
// SSRF protection: URL validation and DNS resolution

import { lookup } from "dns/promises";
import { ENV } from "../config/environment.js";
import {
    isBlockedHostname,
    isLocalhostHostname,
    isBlockedIp,
    isLocalhostIp,
    isAllowedLocalhostPort,
} from "../config/security/ssrf.js";
import type { UrlValidationResult } from "../types/index.js";
import { getErrorMessage } from "../utils/index.js";

/**
 * Check if localhost requests are allowed.
 * Config override takes precedence over environment variable.
 *
 * @param configOverride - If provided, overrides the environment variable check
 */
export function isLocalhostAllowed(configOverride?: boolean): boolean {
    if (configOverride !== undefined) {
        return configOverride;
    }
    const value = process.env[ENV.ALLOW_LOCALHOST]?.toLowerCase();
    return value === "true" || value === "1" || value === "yes";
}

/**
 * Resolve DNS for a hostname and return the IP address.
 * This is used to pin DNS resolution and prevent DNS rebinding attacks.
 *
 * @throws Error if DNS resolution fails
 */
export async function resolveDns(hostname: string): Promise<string> {
    try {
        const result = await lookup(hostname);
        return result.address;
    } catch (error) {
        throw new Error(`DNS resolution failed for "${hostname}": ${getErrorMessage(error)}`);
    }
}

/**
 * Validate URL is not internal and resolve DNS to prevent rebinding attacks.
 *
 * DNS Rebinding Prevention: We resolve DNS ourselves and validate the IP BEFORE
 * passing to cURL. We then use --resolve to pin cURL to our validated IP.
 * This prevents attacks where:
 *   1. Attacker's DNS returns public IP (passes hostname check)
 *   2. DNS TTL expires or attacker rebinds
 *   3. cURL re-resolves and gets private IP (127.0.0.1)
 *   4. cURL connects to internal service
 *
 * By resolving once and pinning with --resolve, cURL uses our validated IP.
 *
 * @param options - Optional overrides for validation behavior
 * @param options.allowLocalhost - Override env var for localhost permission
 * @throws Error if URL uses blocked protocol, targets internal network, or localhost without permission
 */
export async function validateUrlAndResolveDns(
    url: string,
    options?: { allowLocalhost?: boolean }
): Promise<UrlValidationResult> {
    // Block file:// protocol which could read local files
    if (url.toLowerCase().startsWith("file://")) {
        throw new Error("file:// URLs are not allowed - they could be used to read local files");
    }

    // Block Windows UNC paths in raw URL (\\server\share)
    if (url.startsWith("\\\\")) {
        throw new Error("UNC paths are not allowed - they could access internal network shares");
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch (error) {
        throw new Error(`Invalid URL format: ${getErrorMessage(error)}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "https:" ? 443 : 80);

    // Only allow http:// and https:// protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Protocol "${parsed.protocol}" is not allowed - only http:// and https:// are supported`);
    }

    // Check hostname against blocked patterns (TLDs, UNC paths, etc.)
    if (isBlockedHostname(hostname)) {
        throw new Error(
            `Requests to internal/private networks are not allowed: ${hostname}`
        );
    }

    // Check if hostname is "localhost" (special handling)
    const hostnameIsLocalhost = isLocalhostHostname(hostname);

    // Resolve DNS to get actual IP (prevents DNS rebinding)
    // For IP addresses, this just returns the IP itself
    const resolvedIp = await resolveDns(hostname);

    // Check if resolved IP is localhost
    const ipIsLocalhost = isLocalhostIp(resolvedIp);

    if (hostnameIsLocalhost || ipIsLocalhost) {
        if (!isLocalhostAllowed(options?.allowLocalhost)) {
            throw new Error(
                `Requests to localhost are blocked by default. ` +
                `Set ${ENV.ALLOW_LOCALHOST}=true to enable local development/testing.` +
                (ipIsLocalhost && !hostnameIsLocalhost
                    ? ` (Note: "${hostname}" resolved to localhost IP ${resolvedIp})`
                    : "")
            );
        }
        // Localhost is allowed, but check port restrictions
        if (!isAllowedLocalhostPort(port)) {
            throw new Error(
                `Localhost requests are restricted to ports 80, 443, and >1024. ` +
                `Port ${port} is not allowed to prevent access to privileged services.`
            );
        }
        // Localhost request is allowed
        return { hostname, port, resolvedIp };
    }

    // Check resolved IP against blocked patterns (catches DNS rebinding)
    if (isBlockedIp(resolvedIp)) {
        throw new Error(
            `DNS rebinding attack detected: "${hostname}" resolved to blocked IP ${resolvedIp}. ` +
            `Requests to internal/private networks are not allowed.`
        );
    }

    return { hostname, port, resolvedIp };
}
