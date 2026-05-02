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
import type { WrappableResult } from "../response/post-processor.js";

/**
 * Per-call wrap closure injected by the caller (built in `tool-wrapper.ts`
 * via `createWrapper(config)`). The hook-executor calls this once at the
 * pipeline exit (after `afterResponse` hooks run, or when a hook
 * short-circuits) so that:
 *
 *   1. The S2 bypass is closed — a `beforeRequest` hook that returns a
 *      `CallToolResult` no longer skips wrap.
 *   2. The hostname passed to wrap is derived from the **final** `ctx.params`
 *      after every `beforeRequest` hook has had its turn. A hook that
 *      rewrites `params.url` (e.g. routing through a proxy) was previously
 *      ignored — the wrap saw the original URL and the per-host throttle
 *      mis-attributed the event.
 *
 * The wrap is idempotent (Symbol-tag short-circuit), so the caller may still
 * pass results through additional wrap layers without double-processing.
 */
type WrapFn = <T extends WrappableResult>(result: T, hostname: string) => T;

/**
 * Per-call hostname extractor — receives the final (post-hook) params and
 * returns the label to use for the wrap's per-call throttle. For
 * curl_execute the extractor reads `params.url`; for jq_query (no URL) the
 * extractor is a constant returning the static label. Centralising the
 * extraction here means the hook-executor never has to know the tool's
 * shape and the outer caller never has to recompute hostname after hooks.
 */
type HostnameExtractor<T> = (params: T) => string;

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
    executor: (p: T, extra: { sessionId?: string; allowLocalhost?: boolean }) => Promise<ToolResult>,
    wrap: WrapFn,
    hostnameOf: HostnameExtractor<T>
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
                // Defence-in-depth: a hook that returns synthesised text
                // bypasses the cURL pipeline (and therefore `processor.ts`'s
                // sanitise+detect pass). Route the synthesised result through
                // the same wrap the executor's return value would hit, so the
                // LLM never receives unsanitised hook output. Hostname comes
                // from the post-mutation params so a proxy-rewriting hook is
                // attributed to the rewritten host, not the original.
                const shortCircuitResult: ToolResult = {
                    content: [{ type: "text", text: result.response }],
                    isError: result.isError,
                };
                return wrap(shortCircuitResult, hostnameOf(ctx.params));
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

        // PR-6b: wrap fires at the pipeline exit so the hostname reflects
        // the final (post-hook) params. The wrap is idempotent on
        // already-wrapped results (e.g. when the inner curl pipeline already
        // sanitised), so the caller may still pass the result through outer
        // wraps without double-processing.
        return wrap(response, hostnameOf(ctx.params));
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
