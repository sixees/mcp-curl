// src/lib/server/schemas.ts
// Zod schemas for tool input validation

import { z } from "zod";
import { createHttpOnlyUrlSchema } from "../utils/index.js";

/**
* Input schema for the curl_execute tool on a server with no `baseUrl`.
* `CurlExecuteBaseUrlSchema` extends it for a server with one, so a relative
* `url` is accepted only where something resolves it.
*/
export const CurlExecuteSchema = z.object({
    url: createHttpOnlyUrlSchema({ description: "The URL to request (http or https)" }),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .describe("HTTP method (defaults to GET, or POST if data or form is provided)"),
    headers: z.record(z.string(), z.string())
        .optional()
        .describe("HTTP headers as key-value pairs (e.g., {\"Content-Type\": \"application/json\"})"),
    data: z.string()
        .optional()
        .describe("Request body data (for POST/PUT/PATCH). Use JSON string for JSON payloads"),
    form: z.record(z.string(), z.string())
        .optional()
        .describe("Form data as key-value pairs (uses multipart/form-data)"),
    follow_redirects: z.boolean()
        .default(true)
        .describe(
            "Follow HTTP redirects (default: true). mcp-curl follows 301, 302, 303, 307 and " +
            "308 one hop at a time, and checks every hop as it checks the first: the host " +
            "list, the SSRF check and the rate limit. A refused hop ends the chain with a " +
            "refusal that says how many requests were sent. 303 turns every method but " +
            "HEAD into a body-less GET, and 301/302 do the same to POST; 307 and 308 keep " +
            "the method and body. A hop to an origin other than the first request's keeps " +
            "only the Accept, Accept-Language, Accept-Encoding and User-Agent headers, plus " +
            "the body headers while the body is kept, and drops basic_auth and bearer_token. Any other 3xx, or one with an empty Location, is returned as is"
        ),
    max_redirects: z.number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe(
            "Maximum number of redirects to follow (default: 10). A chain longer than this " +
            "is refused as LOCAL_REDIRECT_REFUSED, not returned as its last 3xx"
        ),
    insecure: z.boolean()
        .default(false)
        .describe("Skip SSL certificate verification (default: false)"),
    /**
     * Request timeout in seconds.
     * Optional - if not provided, defaults are applied in this order:
     * 1. McpCurlConfig.defaultTimeout (if configured)
     * 2. LIMITS.DEFAULT_TIMEOUT_MS / 1000 (30 seconds)
     *
     * Note: This field intentionally has no .default() to distinguish between
     * "user explicitly passed 30" vs "user didn't provide a value".
     */
    timeout: z.number()
        .int()
        .min(1)
        .max(300)
        .optional()
        .describe("Request timeout in seconds (default: 30, max: 300)"),
    user_agent: z.string()
        .optional()
        .describe("Custom User-Agent header. If not set, a browser-like User-Agent is sent automatically. Set to empty string to disable."),
    basic_auth: z.string()
        .optional()
        .describe("Basic authentication in format 'username:password'"),
    bearer_token: z.string()
        .optional()
        .describe("Bearer token for Authorization header"),
    verbose: z.boolean()
        .default(false)
        .describe("Include verbose output with request/response details"),
    include_headers: z.boolean()
        .default(false)
        .describe(
            "Report response headers. They never enter the saved file or the jq_filter " +
            "input, which is what makes this safe to combine with save_to_file and " +
            "jq_filter. With include_metadata they arrive under a separate 'headers' key; " +
            "without it they arrive as their OWN content entry after the body, so the body " +
            "entry stays parseable on its own — never split content[0]. That entry is " +
            "present only when headers were actually captured: where none were (see " +
            "headers_undetermined and headers_unsupported below) it is omitted entirely, " +
            "and a server notice may then occupy content[1]. Match on the entry's content " +
            "rather than trusting its index. " +
            "Capped at the smaller of 64KB and max_result_size. Three out-of-band " +
            "states are reported beside the text, never inside it: headers_truncated " +
            "(the text was cut), headers_undetermined (requested, but the origin sent no " +
            "header block), and headers_unsupported (this host cannot capture headers at " +
            "all, because capture requires macOS — a fact about the host, not about the " +
            "origin). After followed redirects, " +
            "these are the final hop's headers only. Header text is sanitised like other " +
            "non-body text, so a value may not match the origin's byte for byte, but it " +
            "is not redacted and routinely carries credential material such as Set-Cookie"
        ),
    compressed: z.boolean()
        .default(true)
        .describe("Request compressed response and automatically decompress"),
    include_metadata: z.boolean()
        .default(false)
        .describe("Wrap response in JSON with metadata (exit code, success status)"),
    jq_filter: z.string()
        // **No `.min(1)` here, deliberately.** `""` is falsy, so
        // `processResponse` skips the filter block and `filterApplied` reports
        // `filtered: false` — a silent no-op that describes itself correctly,
        // not a wrong answer. Refusing it at this schema would narrow an
        // accepted input on a published entry point, which invariant 11 prices
        // as a MAJOR, and `filterApplied` is the guarantee either way.
        // `LESSONS.md` RC-36.
        .optional()
        .describe("JSON path filter to extract specific data. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported. Applied after response, before max_result_size check."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger responses auto-save to temp file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save response to temp file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save response files (must exist and be writable). Overrides MCP_CURL_OUTPUT_DIR env var. Falls back to system temp directory."),
});

/**
 * `CurlExecuteSchema` for a server with a `baseUrl`: `url` also accepts a path
 * starting with `/`, which the handler resolves against the base.
 *
 * The relative branch admits anything starting `/` or `\`. Which of those
 * may be joined is `resolveRequestUrl`'s to decide, and its refusal reaches
 * the model as a tool result; a schema rejection is a protocol error the model
 * never reads. An absolute non-http(s) URL still fails here, at parse.
 *
 * Registered only when `baseUrl` is set, so every other server advertises the
 * strict schema byte for byte. A union rather than `z.preprocess(..., z.url())`:
 * the union advertises `anyOf: [format uri | pattern]`, where a preprocess
 * would claim `format: uri` for a value that is a path.
 */
export const CurlExecuteBaseUrlSchema = CurlExecuteSchema.extend({
    url: z.union([
        createHttpOnlyUrlSchema({ description: "An absolute http(s) URL" }),
        z.string()
            .regex(/^[/\\]/, "Must be an absolute http(s) URL, or a path starting with /")
            .describe("A path starting with /, resolved against the configured base URL"),
    ]).describe("The URL to request: an absolute http(s) URL, or a path starting with a single / resolved against the configured base"),
});

/** Inferred TypeScript type from CurlExecuteSchema */
export type CurlExecuteInput = z.infer<typeof CurlExecuteSchema>;

/**
 * Schema for jq_query tool (query JSON files without HTTP requests).
 */
export const JqQuerySchema = z.object({
    filepath: z.string()
        .describe("Path to a JSON file to query. Must be in temp directory, MCP_CURL_OUTPUT_DIR, or current working directory."),
    jq_filter: z.string()
        // Required here, so `""` is the only degenerate value — and this one
        // narrows nothing: `splitJqFilters("")` is `[]`, so
        // `applyJqFilterToParsed` already throws *"filter must specify a path"*
        // and only the error's site and wording change. That asymmetry is why
        // this `.min(1)` is here and `CurlExecuteSchema`'s `jq_filter` has none —
        // there it is optional and `""` means "no filter".
        .min(1, "jq_filter must not be empty")
        .describe("JSON path filter expression. Supports: .key, .[n] or .n (non-negative array index), .[n:m] (slice), .[\"key\"] (bracket notation), .a,.b (multiple comma-separated paths return array, max 20). Negative indices not supported."),
    max_result_size: z.number()
        .int()
        .min(1000)
        .max(1_000_000)
        .optional()
        .describe("Max bytes to return inline (default: 500KB, max: 1MB). Larger results auto-save to file"),
    save_to_file: z.boolean()
        .optional()
        .describe("Force save result to file. Returns filepath instead of content"),
    output_dir: z.string()
        .optional()
        .describe("Directory to save result files (must exist and be writable)"),
});

/** Inferred TypeScript type from JqQuerySchema */
export type JqQueryInput = z.infer<typeof JqQuerySchema>;
