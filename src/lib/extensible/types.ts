// src/lib/extensible/types.ts
// Internal types for the extensible module

import type {
    McpCurlConfig,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,
    CurlExecuteInput,
    JqQueryInput,
} from "../types/public.js";

/**
 * Result returned by tool executor functions.
 * Includes index signature for MCP SDK compatibility.
 *
 * **`content` carries one entry per remote-controlled region, and it is an
 * array rather than a single-element tuple.** `curl_execute` returns a second
 * entry for response header text and a third for server-authored notices, both
 * plain-branch only, because one entry spanning more than one region is what
 * ARCHITECTURE.md invariant 16 names as a violation — a defence pass whose input
 * spans more than one region — and the wrap defends each entry independently.
 * `content[0]` is the body on every branch, so a reader indexing it reads the
 * body.
 *
 * The `[key: string]: unknown` index signature relaxes structural enforcement
 * regardless — a value reaching consumers via cast or spread from a
 * less-specific source may not actually have this shape. Consumers **MUST**
 * runtime-check the entry they read (notably the spotlighting boundary in
 * `post-processor.ts`'s `createWrapper`) rather than trusting the declaration.
 */
export interface ToolResult {
    [key: string]: unknown;
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

/**
 * Collection of hooks registered on the server.
 */
export interface Hooks {
    beforeRequest: BeforeRequestHook[];
    afterResponse: AfterResponseHook[];
    onError: OnErrorHook[];
}

/**
 * Extra context passed to tool executor.
 */
export interface ToolExtra {
    sessionId?: string;
    allowLocalhost?: boolean;
}

/**
 * Tool executor function signature for curl_execute.
 */
export type CurlToolExecutor = (
    params: CurlExecuteInput,
    extra: ToolExtra
) => Promise<ToolResult>;

/**
 * Tool executor function signature for jq_query.
 */
export type JqToolExecutor = (
    params: JqQueryInput,
    extra: ToolExtra
) => Promise<ToolResult>;

/**
 * Options for registering curl_execute tool with hooks.
 * Note: meta is not included because we use the canonical CURL_EXECUTE_TOOL_META
 */
export interface CurlRegisterToolOptions {
    executor: CurlToolExecutor;
    enabled: boolean;
    config: Readonly<McpCurlConfig>;
    hooks: Hooks;
}

/**
 * Options for registering jq_query tool with hooks.
 * Note: meta is not included because we use the canonical JQ_QUERY_TOOL_META
 */
export interface JqRegisterToolOptions {
    executor: JqToolExecutor;
    enabled: boolean;
    config: Readonly<McpCurlConfig>;
    hooks: Hooks;
}

/**
 * Tool names supported by the server.
 */
export type ToolName = "curl_execute" | "jq_query";

/**
 * Input type for a given tool name.
 */
export type ToolInput<T extends ToolName> = T extends "curl_execute"
    ? CurlExecuteInput
    : T extends "jq_query"
      ? JqQueryInput
      : never;
