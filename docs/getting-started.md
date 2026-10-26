# Getting Started with mcp-curl

This guide walks you through creating your first MCP cURL server.

## Prerequisites

- Node.js 22 or later
- npm or yarn
- An MCP client (Claude Desktop, Claude Code, or another MCP-compatible client)

## Installation

Create a new project and install mcp-curl:

```bash
mkdir my-mcp-server
cd my-mcp-server
npm init -y
npm install mcp-curl
```

Add TypeScript (recommended):

```bash
npm install -D typescript @types/node
npx tsc --init
```

Update `tsconfig.json` for ESM:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": [
    "src/**/*"
  ]
}
```

Update `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Creating Your First Server

Create `src/index.ts`:

```typescript
import {McpCurlServer} from "mcp-curl";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://jsonplaceholder.typicode.com",
    });

await server.start("stdio");
```

Build and run:

```bash
npm run build
npm start
```

The server is now running on stdio, ready for an MCP client to connect.

## Running with HTTP Transport

For web-based clients or testing with HTTP:

```typescript
import {McpCurlServer} from "mcp-curl";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://jsonplaceholder.typicode.com",
        port: 3000,
    });

await server.start("http");
```

The server will listen at `http://localhost:3000/mcp`.

## Adding Configuration

Common configuration options:

```typescript
const server = new McpCurlServer()
    .configure({
        // Base URL prepended to relative URLs
        baseUrl: "https://api.example.com",

        // Headers added to all requests
        defaultHeaders: {
            "Accept": "application/json",
            "X-Client": "my-mcp-server",
        },

        // User-Agent / Referer for every request (empty string disables)
        defaultUserAgent: "my-mcp-server/1.0",

        // Default timeout in seconds
        defaultTimeout: 60,

        // Max response size before auto-saving to file
        maxResultSize: 500_000,

        // Allow localhost requests (blocked by default for security)
        allowLocalhost: false,

        // Wrap text content parts in per-message sentinel envelopes
        // (defence-in-depth; injection-detect always runs, and the sanitise
        // runs on every non-JSON text part)
        enableSpotlighting: true,
    });
```

## Reporting a configuration error

`configure()` throws when an option fails validation — a `rateLimit` field
that is not a positive integer, or a `curlExecuteDescriptionAppend` over its
cap — and a throw leaves the configuration as it was. Your own config loading
can fail too: a missing API key, an unparseable number. Uncaught, either one
kills the process before an MCP client connects, and the client shows only
that the server exited.

To report the reason inside the session instead, catch the failure, start
anyway, and answer each well-formed `curl_execute` call with it:

```typescript
import {McpCurlServer} from "mcp-curl";

function loadConfig() {
    const apiKey = process.env.EXAMPLE_API_KEY;
    if (!apiKey) {
        throw new Error("EXAMPLE_API_KEY is not set");
    }
    return {
        defaultHeaders: {"Authorization": `Bearer ${apiKey}`},
        rateLimit: {max: Number(process.env.EXAMPLE_MAX_PER_HOUR ?? 200), windowMs: 3_600_000},
    };
}

// Fixed options first, outside the try, so a failure below cannot drop them.
const server = new McpCurlServer().configure({
    baseUrl: "https://api.example.com",
    curlExecuteDescriptionAppend: "Example API v2. Paths start with /v2.",
});

let configError: string | undefined;
try {
    server.configure(loadConfig());
} catch (error) {
    configError = error instanceof Error ? error.message : String(error);
}

if (configError !== undefined) {
    const reason = `This server is not configured: ${configError}`;
    // Registered before any other beforeRequest hook, so none of them runs.
    server.beforeRequest((ctx) => {
        if (ctx.tool === "curl_execute") {
            return {shortCircuit: true, response: reason, isError: true};
        }
    });
}

await server.start("stdio");
```

- **Load inside the `try`.** Config read at module scope, or a
  `process.exit` in your loader, fails before the `try` is reached.
- **Configure the fixed options first.** A throw rejects the whole
  `configure()` call. If `baseUrl` were in the failing call it would stay
  unset, so a relative `url` would fail the input schema before the hook runs
  and the model would never see the reason. The description append would be
  lost the same way.
- **Guard `curl_execute` only.** `jq_query` reads files already saved and
  needs no configuration, so it keeps working.
- **Name the variable, never its value.** The reason is returned to the model
  and lands in the transcript. Write your loader's messages the same way.
- **Custom tools bypass hooks.** A handler registered with `registerCustomTool()` needs
  the same check: return the reason with `isError: true` before it calls
  `utilities()`.
- **A malformed call still gets the schema's error.** Input validation runs
  before any hook, so a call with an invalid `url` is answered with the
  validation error, not the configuration error.

The short-circuit response goes through the same wrap as real tool output; see
[Hooks → Short-Circuit Pattern](./hooks.md#short-circuit-pattern).

## Adding Hooks

Hooks let you intercept requests and responses:

```typescript
const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"})

    // Add auth to all requests
    .beforeRequest((ctx) => {
        if (ctx.tool !== "curl_execute" || !("headers" in ctx.params)) {
            return;
        }

        const token = process.env.API_TOKEN;
        if (!token) {
            console.warn("API_TOKEN is not set; skipping Authorization header.");
            return;
        }

        return {
            params: {
                headers: {
                    ...(ctx.params.headers ?? {}),
                    "Authorization": `Bearer ${token}`,
                },
            },
        };
    })

    // Log all responses (use console.error for stdio transport)
    .afterResponse((ctx) => {
        console.error(`${ctx.tool}: ${ctx.response.length} bytes`);
    })

    // Track errors
    .onError((ctx) => {
        console.error(`Error in ${ctx.tool}:`, ctx.error.message);
    });

await server.start("stdio");
```

## Testing with Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "my-api": {
      "command": "node",
      "args": [
        "/path/to/my-mcp-server/dist/index.js"
      ]
    }
  }
}
```

Restart Claude Desktop. Your server's tools will now be available.

## Testing with Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "node",
      "args": [
        "./dist/index.js"
      ]
    }
  }
}
```

## Next Steps

- [Configuration Reference](./configuration.md) - All configuration options
- [Hooks Guide](./hooks.md) - Detailed hook patterns
- [YAML Schema](./api-schema.md) - Define APIs declaratively
- [Custom Tools](./custom-tools.md) - Create specialized tools

## Example Project Structure

```text
my-mcp-server/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

See the [examples/basic/](../examples/basic/) directory for a complete working example.
