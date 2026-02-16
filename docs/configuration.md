# Configuration Reference

This document covers all configuration options for `McpCurlServer`.

## McpCurlConfig Interface

```typescript
interface McpCurlConfig {
    baseUrl?: string;
    defaultHeaders?: Record<string, string>;
    defaultTimeout?: number;
    outputDir?: string;
    maxResultSize?: number;
    allowLocalhost?: boolean;
    port?: number;
    host?: string;
    authToken?: string;
    allowedOrigins?: string[];
}
```

## Configuration Options

| Option           | Type                     | Default     | Description                                           |
|------------------|--------------------------|-------------|-------------------------------------------------------|
| `baseUrl`        | `string`                 | none        | Base URL prepended to relative URLs in `curl_execute` |
| `defaultHeaders` | `Record<string, string>` | none        | Headers added to all `curl_execute` requests          |
| `defaultTimeout` | `number`                 | 30          | Default timeout in seconds (1-300)                    |
| `outputDir`      | `string`                 | system temp | Directory for saved responses                         |
| `maxResultSize`  | `number`                 | 500000      | Max bytes before auto-saving to file (max 1MB)        |
| `allowLocalhost` | `boolean`                | false       | Allow localhost requests (blocked by default)         |
| `port`           | `number`                 | 3000        | HTTP transport port                                   |
| `host`           | `string`                 | "127.0.0.1" | HTTP transport bind address                           |
| `authToken`      | `string`                 | none        | Bearer token for HTTP transport authentication        |
| `allowedOrigins` | `string[]`               | localhost   | Allowed origins for HTTP Origin header validation     |

## Detailed Options

### baseUrl

Prepended to relative URLs. Useful for API-specific servers:

```typescript
.
configure({baseUrl: "https://api.example.com/v1"})
```

Then `curl_execute` with `url: "/users"` becomes `https://api.example.com/v1/users`.

### defaultHeaders

Added to all requests. Merged with request-specific headers (request headers take precedence):

```typescript
.
configure({
    defaultHeaders: {
        "Accept": "application/json",
        "X-Client-Version": "1.0.0",
    }
})
```

### defaultTimeout

Default request timeout in seconds. Can be overridden per-request:

```typescript
.
configure({defaultTimeout: 60})
```

### outputDir

Directory where large responses are saved. Falls back to system temp directory:

```typescript
.
configure({outputDir: "/var/data/mcp-responses"})
```

Can also be set via `MCP_CURL_OUTPUT_DIR` environment variable.

### maxResultSize

Maximum bytes to return inline. Larger responses auto-save to file:

```typescript
.
configure({maxResultSize: 1_000_000}) // 1MB
```

### allowLocalhost

By default, localhost requests are blocked for security. Enable for local development:

```typescript
.
configure({allowLocalhost: true})
```

Can also be set via `MCP_CURL_ALLOW_LOCALHOST=true` environment variable.

### port

HTTP transport listening port:

```typescript
.
configure({port: 8080})
```

Can also be set via `PORT` environment variable.

### host

HTTP transport bind address:

```typescript
.
configure({host: "0.0.0.0"}) // Listen on all interfaces
```

Default: `"127.0.0.1"` (localhost only). Can also be set via `MCP_CURL_HOST` environment variable.

### authToken

Require bearer token authentication for HTTP transport:

```typescript
.
configure({authToken: process.env.MCP_AUTH_TOKEN})
```

Clients must include the configured token in the `Authorization: Bearer <token>` header.

Can also be set via `MCP_AUTH_TOKEN` environment variable.

### allowedOrigins

Override the default Origin header validation for HTTP transport:

```typescript
.
configure({allowedOrigins: ["https://myapp.example.com", "https://admin.example.com"]})
```

By default, only localhost origins are allowed. Setting this replaces the defaults entirely. Can also be set via
`MCP_CURL_ALLOWED_ORIGINS` (comma-separated).

## Environment Variables

Configuration can be set via environment variables (config takes precedence):

| Variable                   | Config Equivalent |
|----------------------------|-------------------|
| `MCP_CURL_OUTPUT_DIR`      | `outputDir`       |
| `MCP_CURL_ALLOW_LOCALHOST` | `allowLocalhost`  |
| `PORT`                     | `port`            |
| `MCP_AUTH_TOKEN`           | `authToken`       |
| `MCP_CURL_HOST`            | `host`            |
| `MCP_CURL_ALLOWED_ORIGINS` | `allowedOrigins`  |

## Configuration Precedence

1. Explicit config passed to `.configure()` (highest priority)
2. Environment variables
3. Built-in defaults (lowest priority)

## Examples

### Minimal Configuration

```typescript
const server = new McpCurlServer()
    .configure({baseUrl: "https://api.example.com"});

await server.start("stdio");
```

### Full Configuration

```typescript
const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.example.com/v1",
        defaultHeaders: {
            "Accept": "application/json",
            "User-Agent": "MyApp/1.0",
        },
        defaultTimeout: 60,
        outputDir: "./responses",
        maxResultSize: 1_000_000,
        allowLocalhost: false,
        port: 3000,
        host: "127.0.0.1",
        allowedOrigins: ["https://myapp.example.com"],
        authToken: process.env.MCP_AUTH_TOKEN,
    });

await server.start("http");
```

### Configuration from Environment

```typescript
// Use environment variables for sensitive config
const server = new McpCurlServer()
    .configure({
        baseUrl: process.env.API_BASE_URL,
        authToken: process.env.MCP_AUTH_TOKEN,
        allowLocalhost: process.env.NODE_ENV === "development",
    });

await server.start(process.env.TRANSPORT === "http" ? "http" : "stdio");
```
