// src/lib/prompts/index.ts
// Prompts barrel export - provides individual prompt registration and combined helper
import { registerApiTestPrompt } from "./api-test.js";
import { registerApiDiscoveryPrompt } from "./api-discovery.js";
export { registerApiTestPrompt } from "./api-test.js";
export { registerApiDiscoveryPrompt } from "./api-discovery.js";
/**
 * Registers all prompts on the MCP server.
 */
export function registerAllPrompts(server) {
    registerApiTestPrompt(server);
    registerApiDiscoveryPrompt(server);
}
