// src/lib/config/constants.ts
// ============================================================================
// Response & Processing Limits
// ============================================================================
export const MAX_RESPONSE_SIZE = 10_000_000; // 10MB max response for processing
export const DEFAULT_MAX_RESULT_SIZE = 500_000; // 500KB default for AI agent responses
export const MAX_TOTAL_RESPONSE_MEMORY = 100_000_000; // 100MB total across all requests
export const ERROR_PREVIEW_LENGTH = 200; // Characters to show in error previews
export const MAX_METADATA_TAIL_LENGTH = 200; // Max distance from end for metadata separator
// ============================================================================
// Server Identity
// ============================================================================
export const SERVER_NAME = "curl-mcp-server";
export const SERVER_VERSION = "1.1.5";
// ============================================================================
// Timeouts
// ============================================================================
export const DEFAULT_TIMEOUT = 30000; // 30 seconds
// ============================================================================
// Temp Directory Management
// ============================================================================
export const TEMP_DIR_PREFIX = "mcp-curl-";
export const ORPHAN_DIR_MIN_AGE_MS = 3600000; // 1 hour
// ============================================================================
// File Handling
// ============================================================================
export const FILENAME_MAX_LENGTH = 50;
// Private Set for efficient lookup - not exported to prevent runtime mutation
const WINDOWS_RESERVED_BASENAMES_SET = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
// Immutable array export for documentation/iteration purposes
export const WINDOWS_RESERVED_BASENAMES = Object.freeze(Array.from(WINDOWS_RESERVED_BASENAMES_SET));
// Helper function for checking reserved names
export function isWindowsReservedBasename(name) {
    return WINDOWS_RESERVED_BASENAMES_SET.has(name);
}
// ============================================================================
// Session Management (HTTP Transport)
// ============================================================================
export const MAX_SESSIONS = 100;
export const SESSION_IDLE_TIMEOUT_MS = 3600000; // 1 hour
export const SESSION_CLEANUP_INTERVAL_MS = 300000; // 5 minutes
// ============================================================================
// Rate Limiting
// ============================================================================
export const MAX_REQUESTS_PER_HOST_PER_MINUTE = 60;
export const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 300;
export const RATE_LIMIT_WINDOW_MS = 60000;
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10000; // 10 seconds
export const STDIO_CLIENT_ID = "__stdio_client__";
// ============================================================================
// JQ Filter Limits (DoS prevention)
// ============================================================================
export const MAX_JQ_FILTER_LENGTH = 500;
export const MAX_JQ_TOKENS = 50;
export const MAX_JQ_FILTERS = 20;
export const MAX_JQ_PARSE_TIME_MS = 100;
export const MAX_JQ_QUERY_FILE_SIZE = MAX_RESPONSE_SIZE; // 10MB
// ============================================================================
// Input Validation
// ============================================================================
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ============================================================================
// Environment Variables
// ============================================================================
export const OUTPUT_DIR_ENV_VAR = "MCP_CURL_OUTPUT_DIR";
export const ALLOW_LOCALHOST_ENV_VAR = "MCP_CURL_ALLOW_LOCALHOST";
export const HTTP_AUTH_TOKEN_ENV_VAR = "MCP_AUTH_TOKEN";
// ============================================================================
// SSRF Protection - Security Rationale
// ============================================================================
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
// SSRF Protection - Blocked Hostname Patterns
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
// SSRF Protection - Localhost Patterns (conditionally allowed)
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
// SSRF Protection - Blocked IP Patterns (after DNS resolution)
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
// SSRF Protection - Localhost IP Patterns
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
// SSRF Protection - Localhost Port Restrictions
// ============================================================================
// Private set - not exported to prevent runtime mutation
const ALLOWED_LOCALHOST_PORTS_INTERNAL = new Set([80, 443]);
export const MIN_UNPRIVILEGED_PORT = 1024;
/** Check if a port is allowed for localhost connections (80, 443, or >1024) */
export function isAllowedLocalhostPort(port) {
    return ALLOWED_LOCALHOST_PORTS_INTERNAL.has(port) || port > MIN_UNPRIVILEGED_PORT;
}
