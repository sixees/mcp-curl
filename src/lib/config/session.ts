// src/lib/config/session.ts
// Session management, rate limiting, and temp directory constants

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
export const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10000; // 10 seconds
export const STDIO_CLIENT_ID = "__stdio_client__";

// ============================================================================
// Temp Directory Management
// ============================================================================
export const TEMP_DIR_PREFIX = "mcp-curl-";
export const ORPHAN_DIR_MIN_AGE_MS = 3600000; // 1 hour
