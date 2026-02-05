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

```
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
        const id = `${ctx.tool}-${Date.now()}`;
        requestTimes.set(id, Date.now());
        console.log(`[${id}] Starting ${ctx.tool}`);
        ctx.params = {...ctx.params, _requestId: id} as any;
    })
    .afterResponse((ctx) => {
        const id = (ctx.params as any)._requestId;
        const duration = Date.now() - (requestTimes.get(id) ?? Date.now());
        requestTimes.delete(id);
        console.log(`[${id}] Completed in ${duration}ms`);
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
    await reportError({
        tool: ctx.tool,
        error: ctx.error.message,
        params: ctx.params,
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
    .beforeRequest((ctx) => console.log("Hook 1"))  // Runs first
    .beforeRequest((ctx) => console.log("Hook 2"))  // Runs second
    .beforeRequest((ctx) => console.log("Hook 3")); // Runs third
```

If a beforeRequest hook returns `{ shortCircuit: true }`, subsequent hooks are skipped.

## Error Handling in Hooks

Errors in hooks are caught and logged but don't prevent tool execution:

```typescript
server.beforeRequest((ctx) => {
    throw new Error("Hook error");  // Logged, but execution continues
});
```

To fail the request, use short-circuit:

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
