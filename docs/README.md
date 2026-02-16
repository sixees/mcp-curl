# mcp-curl Library Documentation

mcp-curl is an MCP (Model Context Protocol) server that enables LLMs to make HTTP requests via cURL. It provides a
secure, configurable way to expose HTTP capabilities to AI assistants like Claude.

## Two Usage Patterns

### 1. McpCurlServer Class

Use the `McpCurlServer` class for full control with a fluent builder API:

```typescript
import {McpCurlServer} from "mcp-curl";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.example.com",
        defaultHeaders: {"Accept": "application/json"},
    })
    .beforeRequest((ctx) => {
        if (ctx.tool !== "curl_execute") return;

        const token = process.env.API_TOKEN;
        if (!token) return;

        return {
            params: {
                headers: {
                    ...(ctx.params.headers ?? {}),
                    "Authorization": `Bearer ${token}`,
                },
            },
        };
    });

await server.start("stdio");
```

### 2. YAML Schema Definitions

Use `createApiServer()` to generate tools from a YAML API definition:

```typescript
import {createApiServer} from "mcp-curl";

const server = await createApiServer({
    definitionPath: "./my-api.yaml",
});
await server.start("stdio");
```

## Installation

```bash
npm install mcp-curl
```

## Quick Start

Minimal server (5 lines):

```typescript
import {McpCurlServer} from "mcp-curl";

const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"});

await server.start("stdio");
```

## Guides

- [Getting Started](./getting-started.md) - Step-by-step setup guide
- [Configuration](./configuration.md) - All configuration options
- [Hooks](./hooks.md) - Request/response interception
- [Custom Tools](./custom-tools.md) - Creating custom MCP tools
- [YAML Schema Reference](./api-schema.md) - API definition format

## Examples

Working example projects in the `examples/` directory:

- [`examples/basic/`](../examples/basic/) - Minimal server setup
- [`examples/with-hooks/`](../examples/with-hooks/) - Authentication and logging hooks
- [`examples/from-yaml/`](../examples/from-yaml/) - Server from YAML definition

## TypeScript Types

All public types are exported from the main package:

```typescript
import type {
    // Configuration
    McpCurlConfig,
    TransportMode,

    // Hooks
    HookContext,
    BeforeRequestResult,
    BeforeRequestHook,
    AfterResponseHook,
    OnErrorHook,

    // Tool inputs
    CurlExecuteInput,
    JqQueryInput,

    // Schema types
    ApiSchema,
    EndpointDefinition,
    AuthConfig,

    // API server
    CreateApiServerOptions,
    CustomToolMeta,
} from "mcp-curl";
```

## Subpath Exports

For advanced use cases, additional exports are available:

```typescript
// Lower-level utilities
import {createServer, CurlExecuteSchema} from "mcp-curl/lib";

// Schema loading and generation
import {loadApiSchema, generateToolDefinitions} from "mcp-curl/schema";
```

## Links

- [Main README](../README.md) - CLI usage and full documentation
- [GitHub Repository](https://github.com/sixees/mcp-curl)
- [MCP Protocol](https://modelcontextprotocol.io/)
