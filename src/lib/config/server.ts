// src/lib/config/server.ts
// Server identity constants

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "../../..", "package.json");

let version = "0.0.0";
try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
    version = packageJson.version ?? "0.0.0";
} catch {
    console.warn(`Warning: Could not read package.json from ${packageJsonPath}`);
}

export const SERVER = {
    /** MCP server name for protocol identification */
    NAME: "curl-mcp-server",
    /** Server version from package.json */
    VERSION: version,
} as const;
