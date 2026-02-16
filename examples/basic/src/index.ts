#!/usr/bin/env node
// Basic mcp-curl server example
//
// This example creates a minimal MCP server that exposes cURL capabilities
// to an LLM. It uses JSONPlaceholder as a test API.

import { McpCurlServer } from "mcp-curl";

// Create and configure the server
const server = new McpCurlServer()
  .configure({
    // Base URL prepended to relative paths
    baseUrl: "https://jsonplaceholder.typicode.com",

    // Default headers for all requests
    defaultHeaders: {
      "Accept": "application/json",
    },

    // Default timeout (30 seconds)
    defaultTimeout: 30,
  });

// Start the server on stdio transport
// The LLM can now use curl_execute and jq_query tools
try {
  await server.start("stdio");
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}
