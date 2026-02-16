# Hooks Guide

Hooks allow you to intercept and modify requests, log responses, and handle errors. They're the primary extension point
for adding custom behavior to mcp-curl.

## Hook Types

### beforeRequest

Called before tool execution. Can modify parameters or short-circuit to return early.

```typescript
type BeforeRequestHook = (ctx: HookContext) =>
    | void
    | { params?: Partial<CurlExecuteInput | JqQueryInput> }
    | { shortCircuit: true; response: string; isError?: boolean };
```

### afterResponse

Called after successful tool execution. Receives the response for logging, metrics, or caching.

```typescript
type AfterResponseHook = (
    ctx: HookContext & { response: string; isError: boolean }
) => void;
```

### onError

Called when tool execution throws an error.

```typescript
type OnErrorHook = (ctx: HookContext & { error: Error }) => void;
```

## HookContext Interface

All hooks receive a context object:

```typescript
interface HookContext<T = CurlExecuteInput | JqQueryInput> {
    tool: "curl_execute" | "jq_query";  // Which tool is executing
    params: T;                          // Tool parameters (mutable in beforeRequest)
    sessionId?: string;                 // Session ID (HTTP transport only)
    config: Readonly<McpCurlConfig>;    // Current frozen configuration
}
```

## Hook Execution Flow

```text
Request arrives
     │
     ▼
┌────────────────┐
│ beforeRequest  │ ──► Can modify params or short-circuit
│ hooks (in      │
│ order)         │
└────────────────┘
     │
     ▼
┌────────────────┐
│ Execute tool   │
└────────────────┘
     │
     ├──► Success ──► afterResponse hooks
     │
     └──► Error ────► onError hooks
```

## Common Patterns

### Auth Injection

Add authentication to all requests:

```typescript
server.beforeRequest((ctx) => {
    if (ctx.tool !== "curl_execute") return;

    const token = process.env.API_TOKEN;
    if (!token) return;

    return {
        params: {
            headers: {
                ...ctx.params.headers,
                "Authorization": `Bearer ${token}`,
            },
        },
    };
});
```

### Request Logging

Log all requests with timing:

```typescript
const requestTimes = new Map<string, number>();

server
    .beforeRequest((ctx) => {
        if (ctx.tool !== "curl_execute") return;

        const requestId = `req-${Date.now()}`;
        requestTimes.set(requestId, Date.now());
        console.error(`[${requestId}] Starting ${ctx.tool}`);

        // Pass the request ID in a header (type-safe alternative to `as any`)
        return {
            params: {
                headers: {...(ctx.params.headers ?? {}), "X-Request-ID": requestId},
            },
        };
    })
    .afterResponse((ctx) => {
        if (ctx.tool !== "curl_execute") return;

        const requestId = ctx.params.headers?.["X-Request-ID"];
        if (!requestId) return;

        const duration = Date.now() - (requestTimes.get(requestId) ?? Date.now());
        requestTimes.delete(requestId);
        console.error(`[${requestId}] Completed in ${duration}ms`);
    })
    .onError((ctx) => {
        // Clean up requestTimes on error (afterResponse won't run)
        if (ctx.tool !== "curl_execute") return;
        const requestId = ctx.params.headers?.["X-Request-ID"];
        if (requestId) requestTimes.delete(requestId);
    });
```

### Response Transformation

Process responses before returning:

```typescript
server.afterResponse((ctx) => {
    if (ctx.tool === "curl_execute" && !ctx.isError) {
        // Log response size
        console.log(`Response size: ${ctx.response.length} bytes`);
    }
});
```

### Metrics Collection

Track request metrics:

```typescript
const metrics = {
    requests: 0,
    errors: 0,
    totalLatency: 0,
};

server
    .beforeRequest(() => {
        metrics.requests++;
    })
    .onError(() => {
        metrics.errors++;
    });
```

### Error Tracking

Report errors to an external service:

```typescript
server.onError(async (ctx) => {
    console.error(`Error in ${ctx.tool}:`, ctx.error.message);

    // Report to error tracking service
    // IMPORTANT: Sanitize params before sending to external services
    // to avoid leaking credentials (Authorization headers, tokens in URLs, etc.)
    const sanitizedParams = {
        url: ctx.params.url,
        method: ctx.params.method,
        // Omit headers, body, and other potentially sensitive fields
    };

    await reportError({
        tool: ctx.tool,
        error: ctx.error.message,
        params: sanitizedParams,
        sessionId: ctx.sessionId,
    });
});
```

### Short-Circuit Pattern

Return a cached or mock response without making the actual request:

```typescript
const cache = new Map<string, { data: string; expires: number }>();

server.beforeRequest((ctx) => {
    if (ctx.tool !== "curl_execute") return;

    const cacheKey = JSON.stringify(ctx.params);
    const cached = cache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
        return {
            shortCircuit: true,
            response: cached.data,
        };
    }
});
```

### Request Validation

Reject requests that don't meet criteria:

```typescript
server.beforeRequest((ctx) => {
    if (ctx.tool === "curl_execute") {
        const url = ctx.params.url;

        // Only allow requests to approved domains
        const allowed = ["api.example.com", "api.another.com"];
        const hostname = new URL(url).hostname;

        if (!allowed.includes(hostname)) {
            return {
                shortCircuit: true,
                response: `Domain ${hostname} is not allowed`,
                isError: true,
            };
        }
    }
});
```

## Async Hooks

All hooks can be async:

```typescript
server.beforeRequest(async (ctx) => {
    // Fetch token from secret manager
    const token = await getSecret("api-token");
    return {
        params: {
            headers: {...ctx.params.headers, "Authorization": `Bearer ${token}`},
        },
    };
});
```

## Hook Registration Order

Hooks run in the order they're registered:

```typescript
server
    .beforeRequest((ctx) => console.error("Hook 1"))  // Runs first
    .beforeRequest((ctx) => console.error("Hook 2"))  // Runs second
    .beforeRequest((ctx) => console.error("Hook 3")); // Runs third
```

If a beforeRequest hook returns `{ shortCircuit: true }`, subsequent hooks are skipped.

## Error Handling in Hooks

**Important:** Errors thrown in hooks propagate and abort the tool call (fail-fast). They are NOT caught and ignored.
The `onError` hook only runs for errors during tool execution, not for errors in `beforeRequest` or `afterResponse`
hooks.

To prevent hook failures from breaking requests, wrap hook bodies in try/catch:

```typescript
server.beforeRequest((ctx) => {
    try {
        // Hook logic that might throw
    } catch (error) {
        console.error("Hook error (non-fatal):", error);
        // Return undefined to continue without modifications
    }
});
```

To intentionally fail the request, use short-circuit:

```typescript
server.beforeRequest((ctx) => {
    if (someCondition) {
        return {
            shortCircuit: true,
            response: "Request blocked",
            isError: true,
        };
    }
});
```

## Testing Hooks

Test hooks by calling them directly:

```typescript
import {describe, it, expect} from "vitest";

const authHook = (ctx: HookContext) => {
    return {
        params: {
            headers: {...ctx.params.headers, "Authorization": "Bearer test"},
        },
    };
};

describe("auth hook", () => {
    it("adds authorization header", () => {
        const ctx = {
            tool: "curl_execute" as const,
            params: {url: "https://example.com", headers: {}},
            config: {},
        };

        const result = authHook(ctx);
        expect(result?.params?.headers?.Authorization).toBe("Bearer test");
    });
});
```
