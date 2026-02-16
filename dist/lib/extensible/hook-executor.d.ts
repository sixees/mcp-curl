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
 * Error Handling:
 * - For afterResponse: if a hook throws, subsequent hooks won't run, and the
 *   error propagates to the caller (onError hooks are NOT called for hook errors).
 *   Wrap hook logic in try-catch internally to prevent failures from aborting the chain.
 * - For onError: hook errors are caught and suppressed (logged as warnings).
 *   Subsequent onError hooks continue to run, and the original tool error is re-thrown.
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
    allowLocalhost?: boolean;
}) => Promise<ToolResult>): Promise<ToolResult>;
