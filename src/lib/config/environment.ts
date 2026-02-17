// src/lib/config/environment.ts
// Environment variable names

/**
 * Canonical environment variable names used by mcp-curl configuration.
 * All values are string literals (use as `process.env[ENV.OUTPUT_DIR]`).
 */
export const ENV = {
    /** Directory for saving response files */
    OUTPUT_DIR: "MCP_CURL_OUTPUT_DIR",
    /** Enable localhost requests for development */
    ALLOW_LOCALHOST: "MCP_CURL_ALLOW_LOCALHOST",
    /** Bearer token for HTTP transport authentication */
    AUTH_TOKEN: "MCP_AUTH_TOKEN",
    /** Comma-separated allowed origins for HTTP transport (default: localhost) */
    ALLOWED_ORIGINS: "MCP_CURL_ALLOWED_ORIGINS",
    /** HTTP transport bind address (default: 127.0.0.1) */
    HOST: "MCP_CURL_HOST",
    /** HTTP transport port (default: 3000) */
    PORT: "PORT",
} as const;
