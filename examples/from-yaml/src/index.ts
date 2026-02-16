#!/usr/bin/env node
// mcp-curl server from YAML definition example
//
// This example creates an MCP server from a YAML API definition file.
// The YAML file declaratively defines all endpoints, which are automatically
// converted to MCP tools.

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createApiServer } from "mcp-curl";

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to YAML definition (relative to dist/index.js -> ../api-definition.yaml)
const definitionPath = join(__dirname, "..", "api-definition.yaml");

try {
  // Create server from YAML definition
  const server = await createApiServer({
    definitionPath,

    // Optionally disable built-in tools to only expose the generated ones
    // disableCurlExecute: true,
    // disableJqQuery: true,

    // Additional config (merged with schema defaults)
    config: {
      // Override or add config here
      // maxResultSize: 1_000_000,
    },
  });

  // Start the server
  await server.start("stdio");
} catch (error) {
  console.error("Failed to start MCP server:", error);
  process.exitCode = 1;
}
