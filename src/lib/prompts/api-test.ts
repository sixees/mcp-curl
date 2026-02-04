// src/lib/prompts/api-test.ts
// Registers the api-test prompt template

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Registers the api-test prompt on the MCP server.
 * Provides a template for testing API endpoints.
 */
export function registerApiTestPrompt(server: McpServer): void {
    server.registerPrompt(
        "api-test",
        {
            title: "API Testing",
            description: "Test an API endpoint and analyze the response",
            argsSchema: {
                url: z.string().url().describe("The API endpoint URL to test"),
                method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional().describe("HTTP method (default: GET)"),
                description: z.string().optional().describe("What this API endpoint does"),
            },
        },
        ({ url, method = "GET", description }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Test the following API endpoint:

URL: ${url}
Method: ${method}
${description ? `Description: ${description}` : ""}

Please:
1. Make the request using curl_execute
2. Analyze the response structure
3. Report the status and any errors
4. Summarize what the response contains`,
                },
            }],
        })
    );
}
