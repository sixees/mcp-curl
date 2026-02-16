// src/lib/config/server.ts
// Server identity constants

// __PACKAGE_VERSION__ is injected at build time by tsup's `define` option.
// Falls back to "0.0.0" when running unbundled (e.g., tests via vitest).
declare const __PACKAGE_VERSION__: string | undefined;

/** MCP server identity constants used for protocol identification and version reporting. */
export const SERVER = {
    /** MCP server name for protocol identification */
    NAME: "curl-mcp-server",
    /** Server version from package.json */
    VERSION: typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "0.0.0",
} as const;
