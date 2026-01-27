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
export const WINDOWS_RESERVED_BASENAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
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
// SSRF Protection - Blocked Hostname Patterns
// ============================================================================
export const BLOCKED_HOSTNAME_PATTERNS = [
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
];
// ============================================================================
// SSRF Protection - Localhost Patterns (conditionally allowed)
// ============================================================================
export const LOCALHOST_HOSTNAME_PATTERNS = [
    /^localhost$/i,
];
// ============================================================================
// SSRF Protection - Blocked IP Patterns (after DNS resolution)
// ============================================================================
export const BLOCKED_IP_PATTERNS = [
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
];
// ============================================================================
// SSRF Protection - Localhost IP Patterns
// ============================================================================
export const LOCALHOST_IP_PATTERNS = [
    /^127\.\d+\.\d+\.\d+$/,
    /^::1$/,
    /^::ffff:127\./i,
];
// ============================================================================
// SSRF Protection - Localhost Port Restrictions
// ============================================================================
export const ALLOWED_LOCALHOST_PORTS = new Set([80, 443]);
export const MIN_UNPRIVILEGED_PORT = 1024;
