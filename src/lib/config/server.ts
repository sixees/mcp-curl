// src/lib/config/server.ts
// Server identity constants

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "../../..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };

export const SERVER = {
    /** MCP server name for protocol identification */
    NAME: "curl-mcp-server",
    /** Server version from package.json */
    VERSION: packageJson.version,
} as const;
