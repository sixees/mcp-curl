// src/lib/extensible/hook-executor.ts
// Executes hook chains for tool calls

import type {
    McpCurlConfig,
    HookContext,
    BeforeRequestResult,
    CurlExecuteInput,
    JqQueryInput,
} from "../types/public.js";
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
export async function executeWithHooks<T extends CurlExecuteInput | JqQueryInput>(
    tool: ToolName,
    params: T,
    config: Readonly<McpCurlConfig>,
    hooks: Hooks,
    sessionId: string | undefined,
    executor: (p: T, extra: { sessionId?: string }) => Promise<ToolResult>
): Promise<ToolResult> {
    // Create mutable context for hooks
    const ctx: HookContext<T> = {
        tool,
        params: { ...params },
        sessionId,
        config,
    };

    // Run beforeRequest hooks sequentially
    for (const hook of hooks.beforeRequest) {
        const result = (await hook(ctx)) as BeforeRequestResult<T> | undefined;

        if (result) {
            // Check for short-circuit
            if ("shortCircuit" in result && result.shortCircuit) {
                return {
                    content: [{ type: "text", text: result.response }],
                    isError: result.isError,
                };
            }

            // Merge params if provided
            if ("params" in result && result.params) {
                ctx.params = { ...ctx.params, ...result.params };
            }
        }
    }

    try {
        // Execute the tool with potentially modified params
        const response = await executor(ctx.params, { sessionId });

        // Run afterResponse hooks sequentially
        const responseText = response.content[0]?.text ?? "";
        for (const hook of hooks.afterResponse) {
            await hook({
                ...ctx,
                response: responseText,
                isError: !!response.isError,
            });
        }

        return response;
    } catch (error) {
        // Run onError hooks sequentially
        for (const hook of hooks.onError) {
            await hook({
                ...ctx,
                error: error as Error,
            });
        }

        // Re-throw the error to be handled by the caller
        throw error;
    }
}
