import type { McpCurlConfig, CurlExecuteInput, JqQueryInput } from "../types/public.js";
import type { Hooks, ToolResult, ToolName } from "./types.js";
/**
 * Execute a tool with before/after/error hooks.
 *
 * Hook execution flow:
 * 1. Run beforeRequest hooks sequentially
 *    - Can modify params via { params: {...} }
 *    - Can short-circuit via { shortCircuit: true, response: "..." }
 * 2. Execute the tool
 * 3. Run afterResponse hooks sequentially
 * 4. On error, run onError hooks instead of afterResponse
 *
 * @param tool - Name of the tool being executed
 * @param params - Tool parameters (will be modified by hooks)
 * @param config - Frozen server configuration
 * @param hooks - Registered hook functions
 * @param sessionId - Session ID for HTTP transport
 * @param executor - The actual tool execution function (receives params and extra)
 * @returns Tool result (from executor or short-circuit)
 */
export declare function executeWithHooks<T extends CurlExecuteInput | JqQueryInput>(tool: ToolName, params: T, config: Readonly<McpCurlConfig>, hooks: Hooks, sessionId: string | undefined, executor: (p: T, extra: {
    sessionId?: string;
}) => Promise<ToolResult>): Promise<ToolResult>;
