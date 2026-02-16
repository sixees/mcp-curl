# Getting Started with mcp-curl

This guide walks you through creating your first MCP cURL server.

## Prerequisites

- Node.js 18 or later
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

        // Default timeout in seconds
        defaultTimeout: 60,

        // Max response size before auto-saving to file
        maxResultSize: 500_000,

        // Allow localhost requests (blocked by default for security)
        allowLocalhost: false,
    });
```

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
