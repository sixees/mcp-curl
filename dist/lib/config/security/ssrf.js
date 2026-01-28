// src/lib/config/security/ssrf.ts
// SSRF protection patterns and pure predicate functions
/**
 * SSRF (Server-Side Request Forgery) Protection
 *
 * These patterns block requests to internal/private networks to prevent attackers
 * from using this server as a proxy to access internal services.
 *
 * KEY SECURITY CONSIDERATIONS:
 *
 * 1. IPv4-Mapped IPv6 Addresses (::ffff:x.x.x.x)
 *    These are IPv6 representations of IPv4 addresses that could bypass IPv4-only
 *    blocklists. For example, ::ffff:127.0.0.1 maps to 127.0.0.1 (localhost).
 *    We explicitly block these in both hostname and IP patterns.
 *
 * 2. DNS Rebinding Prevention
 *    Attackers can configure DNS to return a public IP initially (passing validation)
 *    then switch to a private IP on subsequent lookups. We prevent this by:
 *    - Resolving DNS ourselves BEFORE validation
 *    - Pinning cURL to our validated IP via --resolve flag
 *    - Checking the resolved IP against blocked patterns (not just hostname)
 *
 * 3. Protocol Restrictions
 *    Only http:// and https:// are allowed. file://, ftp://, gopher://, etc.
 *    could be used to read local files or access other services.
 *
 * 4. Internal TLD Blocking
 *    .local, .internal, .corp, .lan, .localhost are commonly used for internal
 *    services and should never be accessible from external requests.
 *
 * 5. Link-Local Addresses (169.254.x.x, fe80::)
 *    These are used for local network configuration (APIPA, NDP) and could
 *    expose cloud metadata services (e.g., AWS 169.254.169.254).
 *
 * 6. Unique Local Addresses (fc00::/7, fd00::/8)
 *    IPv6 equivalent of private address ranges - used for internal networks.
 *
 * DEFENSE IN DEPTH:
 * We check BOTH hostnames AND resolved IPs because:
 * - Hostname check catches obvious internal addresses before DNS lookup
 * - IP check catches DNS rebinding and hostnames that resolve to internal IPs
 *
 * TODO: Consider adding cloud metadata endpoint blocking (169.254.169.254,
 * fd00:ec2::254, metadata.google.internal, etc.) as explicit patterns.
 */
// ============================================================================
// Blocked Hostname Patterns
// ============================================================================
// Private array - not exported to prevent runtime mutation
const BLOCKED_HOSTNAME_PATTERNS_INTERNAL = Object.freeze([
    // IPv4 loopback and mapped IPv6
    /^127\.\d+\.\d+\.\d+$/,
    /^\[?::ffff:127\.\d+\.\d+\.\d+\]?$/i,
    // Private Class A (10.x.x.x) and mapped IPv6
    /^10\.\d+\.\d+\.\d+$/,
    /^\[?::ffff:10\.\d+\.\d+\.\d+\]?$/i,
    // Private Class B (172.16-31.x.x) and mapped IPv6
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^\[?::ffff:172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\]?$/i,
    // Private Class C (192.168.x.x) and mapped IPv6
    /^192\.168\.\d+\.\d+$/,
    /^\[?::ffff:192\.168\.\d+\.\d+\]?$/i,
    // Link-local (169.254.x.x) and mapped IPv6
    /^169\.254\.\d+\.\d+$/,
    /^\[?::ffff:169\.254\.\d+\.\d+\]?$/i,
    // All interfaces
    /^0\.0\.0\.0$/,
    /^\[?::ffff:0\.0\.0\.0\]?$/i,
    // IPv6 loopback
    /^\[?::1\]?$/,
    // IPv6 link-local
    /^\[?fe80:/i,
    // IPv6 unique local (fc00::/7)
    /^\[?fc00:/i,
    /^\[?fd[0-9a-f]{2}:/i,
    // Internal TLDs
    /\.local$/i,
    /\.internal$/i,
    /\.corp$/i,
    /\.lan$/i,
    /\.localhost$/i,
    // Windows UNC paths
    /^\\\\[^\\]+/,
]);
/** Check if a hostname matches any blocked pattern (internal networks, reserved TLDs, etc.) */
export function isBlockedHostname(hostname) {
    return BLOCKED_HOSTNAME_PATTERNS_INTERNAL.some(pattern => pattern.test(hostname));
}
// ============================================================================
// Localhost Hostname Patterns (conditionally allowed)
// ============================================================================
// Private array - not exported to prevent runtime mutation
const LOCALHOST_HOSTNAME_PATTERNS_INTERNAL = Object.freeze([
    /^localhost$/i,
]);
/** Check if a hostname is a localhost variant */
export function isLocalhostHostname(hostname) {
    return LOCALHOST_HOSTNAME_PATTERNS_INTERNAL.some(pattern => pattern.test(hostname));
}
// ============================================================================
// Blocked IP Patterns (after DNS resolution)
// ============================================================================
// Private array - not exported to prevent runtime mutation
const BLOCKED_IP_PATTERNS_INTERNAL = Object.freeze([
    /^127\.\d+\.\d+\.\d+$/,
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^169\.254\.\d+\.\d+$/,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^fe80:/i,
    /^fc00:/i,
    /^fd[0-9a-f]{2}:/i,
    /^::ffff:127\./i,
    /^::ffff:10\./i,
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:169\.254\./i,
    /^::ffff:0\.0\.0\.0$/i,
]);
/** Check if an IP address matches any blocked pattern (private networks, link-local, etc.) */
export function isBlockedIp(ip) {
    return BLOCKED_IP_PATTERNS_INTERNAL.some(pattern => pattern.test(ip));
}
// ============================================================================
// Localhost IP Patterns
// ============================================================================
// Private array - not exported to prevent runtime mutation
const LOCALHOST_IP_PATTERNS_INTERNAL = Object.freeze([
    /^127\.\d+\.\d+\.\d+$/,
    /^::1$/,
    /^::ffff:127\./i,
]);
/** Check if an IP address is a localhost address */
export function isLocalhostIp(ip) {
    return LOCALHOST_IP_PATTERNS_INTERNAL.some(pattern => pattern.test(ip));
}
// ============================================================================
// Localhost Port Restrictions
// ============================================================================
// Private set - not exported to prevent runtime mutation
const ALLOWED_LOCALHOST_PORTS_INTERNAL = new Set([80, 443]);
export const MIN_UNPRIVILEGED_PORT = 1024;
/** Check if a port is allowed for localhost connections (80, 443, or >1024) */
export function isAllowedLocalhostPort(port) {
    return ALLOWED_LOCALHOST_PORTS_INTERNAL.has(port) || port > MIN_UNPRIVILEGED_PORT;
}
