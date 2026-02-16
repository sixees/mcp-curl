import type { UrlValidationResult } from "../types/index.js";
/**
 * Check if localhost requests are allowed.
 * Config override takes precedence over environment variable.
 *
 * @param configOverride - If provided, overrides the environment variable check
 */
export declare function isLocalhostAllowed(configOverride?: boolean): boolean;
/**
 * Resolve DNS for a hostname and return the IP address.
 * This is used to pin DNS resolution and prevent DNS rebinding attacks.
 *
 * @throws Error if DNS resolution fails
 */
export declare function resolveDns(hostname: string): Promise<string>;
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
export declare function validateUrlAndResolveDns(url: string, options?: {
    allowLocalhost?: boolean;
}): Promise<UrlValidationResult>;
