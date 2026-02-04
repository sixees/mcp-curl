// src/lib/prompts/api-discovery.ts
// Registers the api-discovery prompt template

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Registers the api-discovery prompt on the MCP server.
 * Provides a template for exploring REST APIs.
 */
export function registerApiDiscoveryPrompt(server: McpServer): void {
    server.registerPrompt(
        "api-discovery",
        {
            title: "REST API Discovery",
            description: "Explore a REST API to discover available endpoints",
            argsSchema: {
                base_url: z.string().url().describe("Base URL of the API"),
                auth_token: z.string().optional().describe("Optional bearer token for authentication"),
            },
        },
        ({ base_url, auth_token }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Explore the REST API at: ${base_url}

${auth_token ? `Use bearer token for authentication: ${auth_token}` : "No authentication token provided."}

Please:
1. Try common discovery endpoints (/api, /api/v1, /health, /swagger.json, /openapi.json)
2. Check for available methods using OPTIONS requests
3. Look for API documentation endpoints
4. Report what you discover about the API structure`,
                },
            }],
        })
    );
}
