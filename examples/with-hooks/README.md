# mcp-curl with Hooks Example

An MCP server demonstrating all three hook types for authentication, logging, and error tracking.

## Setup

```bash
npm install
npm run build
```

> **Note:** When copying this example to your own project, change the dependency in `package.json` from `"file:../.."`
> to `"mcp-curl": "^1.1.5"` (or latest version).

## Running

With optional API token:

```bash
API_TOKEN=your-token npm start
```

Or without token (auth header won't be added):

```bash
npm start
```

## What This Example Demonstrates

### beforeRequest Hook

- Generates a unique request ID for tracking
- Adds `Authorization` header from `API_TOKEN` environment variable
- Logs each incoming request

### afterResponse Hook

- Calculates request latency
- Logs success/failure with timing
- Collects metrics (total requests, success rate, average latency)

### onError Hook

- Logs errors with request context
- Tracks failed request count
- Shows where to integrate error reporting services

## Output

The server logs to stderr (so it doesn't interfere with MCP communication):

```text
[req-1234-abc123] curl_execute: /users
[req-1234-abc123] Success (145ms) - 2847 bytes
[Metrics] Requests: 10, Success: 9, Failed: 1, Avg Latency: 132ms
```

## Metrics on Shutdown

When you stop the server (Ctrl+C), it prints final metrics:

```text
[Shutdown] Final metrics:
  Total requests: 25
  Successful: 23
  Failed: 2
  Avg latency: 128ms
```

## Code Highlights

```typescript
// beforeRequest: Add auth and tracking
.beforeRequest((ctx) => {
    const token = process.env.API_TOKEN;
    return {
        params: {
            headers: {
                ...(ctx.params.headers ?? {}),
                ...(token && {"Authorization": `Bearer ${token}`}),
                "X-Request-ID": generateRequestId(),
            },
        },
    };
})

// afterResponse: Log and collect metrics
.afterResponse((ctx) => {
    const latency = Date.now() - startTime;
    console.error(`[${requestId}] ${ctx.isError ? 'Failed' : 'Success'} (${latency}ms)`);
})

// onError: Track and report errors
.onError((ctx) => {
    console.error(`Error in ${ctx.tool}: ${ctx.error.message}`);
});
```

## Extending This Example

Ideas for building on this:

1. **Rate limiting**: Track requests per domain and return early if limit exceeded
2. **Caching**: Store responses and short-circuit for repeated requests
3. **Request validation**: Block requests to unauthorized domains
4. **Response transformation**: Parse and filter responses before returning
5. **Audit logging**: Write detailed logs to file or database
