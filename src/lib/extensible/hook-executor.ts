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
 * Error Handling:
 * - For afterResponse: if a hook throws, the error is caught and passed to
 *   onError hooks (same as tool execution errors). This means afterResponse
 *   hook errors are observable via onError hooks for logging/reporting.
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
export async function executeWithHooks<T extends CurlExecuteInput | JqQueryInput>(
    tool: ToolName,
    params: T,
    config: Readonly<McpCurlConfig>,
    hooks: Hooks,
    sessionId: string | undefined,
    executor: (p: T, extra: { sessionId?: string; allowLocalhost?: boolean }) => Promise<ToolResult>
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
        const response = await executor(ctx.params, { sessionId, allowLocalhost: config.allowLocalhost });

        // Run afterResponse hooks sequentially
        // content[0] is guaranteed by ToolResult tuple type
        const responseText = response.content[0].text;
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
        // Preserve non-Error thrown values by wrapping them
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        for (const hook of hooks.onError) {
            try {
                await hook({
                    ...ctx,
                    error: normalizedError,
                });
            } catch (hookError) {
                // Log only error name to avoid exposing sensitive data from hook context
                const hookErrorName = hookError instanceof Error ? hookError.name : "UnknownError";
                console.error(`Warning: onError hook threw (${hookErrorName}) [suppressed to preserve original error]`);
            }
        }

        // Re-throw the original error to preserve stack trace
        throw error;
    }
}
