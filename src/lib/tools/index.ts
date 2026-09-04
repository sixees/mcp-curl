// src/lib/tools/index.ts
// Tools barrel export - provides the combined registration helper and the
// executors/metadata the extensible server composes for itself.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpCurlConfig } from "../types/public.js";
import type { Hooks } from "../extensible/types.js";
import { registerCurlToolWithHooks, registerJqToolWithHooks } from "../extensible/tool-wrapper.js";
import { executeCurlRequest } from "./curl-execute.js";
import { executeJqQuery } from "./jq-query.js";

// Executor functions and metadata (for McpCurlServer extensible class)
export {
    executeCurlRequest,
    CURL_EXECUTE_TOOL_META,
    type CurlExecuteResult,
    type CurlExecuteExtra,
} from "./curl-execute.js";
export {
    executeJqQuery,
    JQ_QUERY_TOOL_META,
    type JqQueryResult,
    type JqQueryExtra,
} from "./jq-query.js";

/**
 * The plain path registers no lifecycle callbacks. `executeWithHooks` only
 * iterates these arrays, never appends to them, so one frozen instance is
 * shared by both registrations.
 */
const NO_HOOKS: Hooks = Object.freeze({
    beforeRequest: [],
    afterResponse: [],
    onError: [],
});

/**
 * The plain path carries no programmatic configuration — the same starting
 * point `McpCurlServer` uses before a consumer calls `configure()`.
 *
 * It is NOT the same as "no configuration": `applyDefaultHeaders` resolves
 * `MCP_CURL_USER_AGENT` and `MCP_CURL_REFERER` from the environment when the
 * config leaves them unset, which is how the shipped binary honours the two
 * env vars `README.md` documents for every request.
 */
const NO_CONFIG: Readonly<McpCurlConfig> = Object.freeze({});

/**
 * Registers all tools on the MCP server.
 *
 * **This is the shipped binary's registration path** — `src/index.ts` →
 * `runStdio()`/`runHTTP()` → `registerAllCapabilities()` → here — and it goes
 * through the same registrars `McpCurlServer` uses, with no hooks and no
 * config. One registration implementation, so invariant 1's post-processor
 * wrap cannot be present on one entry point and absent on the other.
 *
 * It previously called the executors raw. That satisfied nothing: the wrap
 * never ran, so a markdown beacon in a response body reached the model
 * verbatim from `curl-mcp` while the same request through `McpCurlServer`
 * returned `[image removed]`. `docs/todos/006` carries the measurement.
 */
export function registerAllTools(server: McpServer): void {
    registerCurlToolWithHooks(server, {
        executor: executeCurlRequest,
        enabled: true,
        config: NO_CONFIG,
        hooks: NO_HOOKS,
    });

    registerJqToolWithHooks(server, {
        executor: executeJqQuery,
        enabled: true,
        config: NO_CONFIG,
        hooks: NO_HOOKS,
    });
}
