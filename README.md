# cURL MCP Server

A security-hardened MCP server that gives LLMs the ability to make HTTP requests via cURL. Use it as a standalone
server, extend it programmatically, or define APIs declaratively with YAML.

**Key features:**

- **Security-first** — SSRF protection, DNS rebinding prevention, rate limiting, input validation
- **Extensible** — `McpCurlServer` class with hooks, custom tools, and configuration
- **YAML-driven** — Define API endpoints declaratively and generate MCP tools automatically
- **Two tools** — `curl_execute` for HTTP requests, `jq_query` for querying saved JSON files

## Quick Start: MCP Server

### Claude Code

```bash
claude mcp add curl -- npx -y github:sixees/mcp-curl
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "curl": {
      "command": "npx",
      "args": [
        "-y",
        "github:sixees/mcp-curl"
      ]
    }
  }
}
```

### Claude Desktop

Add to your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "curl": {
      "command": "npx",
      "args": [
        "-y",
        "github:sixees/mcp-curl"
      ]
    }
  }
}
```

## Quick Start: Standalone

```bash
# Stdio transport (default)
npx -y github:sixees/mcp-curl

# HTTP transport
TRANSPORT=http PORT=3000 npx -y github:sixees/mcp-curl

# HTTP with authentication
TRANSPORT=http PORT=3000 MCP_AUTH_TOKEN=your-secret npx -y github:sixees/mcp-curl
```

Or clone and build locally:

```bash
git clone https://github.com/sixees/mcp-curl.git
cd mcp-curl && npm install && npm run build
npm start
```

## Tools

### `curl_execute`

Execute HTTP requests with structured parameters. Supports all common HTTP methods, authentication (basic, bearer),
headers, form data, redirects, and timeouts.

```json
{
  "url": "https://api.github.com/users/octocat",
  "bearer_token": "ghp_xxx",
  "jq_filter": ".name,.email,.location"
}
```

Responses exceeding `max_result_size` (default 500KB) are automatically saved to file. Use `jq_filter` to extract
specific data before the size limit is checked.

### `jq_query`

Query saved JSON files without making new HTTP requests:

```json
{
  "filepath": "/path/to/saved_response.txt",
  "jq_filter": ".users[0:5]"
}
```

Files must be in the temp directory, `MCP_CURL_OUTPUT_DIR`, or current working directory.

### jq_filter syntax

| Syntax         | Example            | Description                     |
|----------------|--------------------|---------------------------------|
| `.key`         | `.data`            | Object property                 |
| `.[n]` or `.n` | `.[0]`, `.0`       | Array index (non-negative only) |
| `.[n:m]`       | `.[0:10]`          | Array slice                     |
| `.["key"]`     | `.["special-key"]` | Bracket notation                |
| `.a,.b,.c`     | `.name,.email`     | Multiple paths (returns array)  |

## Programmatic API

Install as a library and build custom MCP servers:

```bash
npm install mcp-curl
```

```typescript
import { McpCurlServer } from "mcp-curl";

const server = new McpCurlServer()
    .configure({
        baseUrl: "https://api.example.com",
        defaultHeaders: {"Authorization": `Bearer ${process.env.API_TOKEN}`},
        defaultTimeout: 60,
    })
    .beforeRequest((ctx) => {
        console.log(`${ctx.tool}: ${ctx.params.url}`);
    })
    .afterResponse((ctx) => {
        console.log(`Response: ${ctx.response.length} bytes`);
    });

await server.start("stdio");
```

See the [library documentation](./docs/README.md) for the full API reference, including hooks, custom tools,
instance utilities, and lifecycle management.

## YAML Schema

Define API endpoints declaratively and generate MCP tools:

```typescript
import { createApiServer } from "mcp-curl";

const server = await createApiServer({
    definitionPath: "./my-api.yaml",
});
await server.start("stdio");
```

```yaml
apiVersion: "1.0"
api:
  name: my-api
  baseUrl: https://api.example.com
endpoints:
  - id: list_items
    path: /items
    method: GET
    title: List Items
    description: Get all items
    parameters:
      - name: page
        in: query
        type: integer
        required: false
```

See [YAML Schema Reference](./docs/api-schema.md) for the full specification including authentication, defaults,
response filtering, and parameter types.

### Fork Workflow

If you fork this repo to build an API-specific server, use the `configs/` directory for your definitions:

```bash
# 1. Fork and clone
git clone https://github.com/your-org/mcp-curl.git
cd mcp-curl && npm install && npm run build

# 2. Copy the template
cp configs/example.yaml.template configs/my-api.yaml

# 3. Edit your API definition
# See docs/api-schema.md for the full YAML specification

# 4. Create your entry point (configs/*.ts is gitignored)
#    See configs/README.md for a full TypeScript template

# 5. Run your server (using tsx to run the TS file directly)
npx tsx configs/my-api.ts
```

Files in `configs/` matching `*.yaml`, `*.yml`, `*.ts`, `*.js` are **gitignored**, so pulling upstream changes
(`git pull upstream main`) won't conflict with your application-specific configuration.

Alternatively, install `mcp-curl` as an npm dependency in a separate project — see
[Getting Started](./docs/getting-started.md).

## Security Highlights

- **SSRF protection** — blocks private IPs, cloud metadata endpoints, DNS rebinding services, internal TLDs
- **DNS rebinding prevention** — DNS resolved before validation, cURL pinned to validated IP via `--resolve`
- **Protocol whitelist** — only `http://` and `https://` allowed; `file://`, `ftp://`, etc. blocked
- **Rate limiting** — 60 req/min per host, 300 req/min per client
- **Input validation** — Zod schemas, CRLF injection prevention, `--data-raw`/`--form-string` to block `@` file reads
- **No shell execution** — commands spawned via `spawn()` without shell; allowlist permits only `curl`
- **File access control** — `jq_query` restricted to temp dir, `MCP_CURL_OUTPUT_DIR`, and cwd; symlinks resolved
- **Resource limits** — 10MB response cap, 100MB global memory, 100ms jq parse timeout, 30s default request timeout
- **Secure file permissions** — temp dirs 0o700, files 0o600 (owner-only)

## Environment Variables

| Variable                   | Description                                 |
|----------------------------|---------------------------------------------|
| `TRANSPORT`                | Transport mode: `stdio` (default) or `http` |
| `PORT`                     | HTTP transport port (default: 3000)         |
| `MCP_AUTH_TOKEN`           | Bearer token for HTTP transport auth        |
| `MCP_CURL_OUTPUT_DIR`      | Default directory for saved responses       |
| `MCP_CURL_ALLOW_LOCALHOST` | Set `true` to allow localhost requests      |

## Documentation

| Guide                                         | Description                                   |
|-----------------------------------------------|-----------------------------------------------|
| [Library Overview](./docs/README.md)          | `McpCurlServer` class and YAML usage patterns |
| [Getting Started](./docs/getting-started.md)  | Step-by-step setup guide                      |
| [Configuration](./docs/configuration.md)      | All configuration options                     |
| [Hooks](./docs/hooks.md)                      | Request/response interception                 |
| [Custom Tools](./docs/custom-tools.md)        | Creating custom MCP tools                     |
| [YAML Schema Reference](./docs/api-schema.md) | API definition format                         |

## Examples

Working example projects in [`examples/`](./examples/):

- [`basic/`](./examples/basic/) — Minimal custom server
- [`with-hooks/`](./examples/with-hooks/) — Authentication and logging hooks
- [`from-yaml/`](./examples/from-yaml/) — Server from YAML API definition

## MCP Resources & Prompts

- **Resource**: `curl://docs/api` — Built-in API documentation
- **Prompts**: `api-test` (test an endpoint), `api-discovery` (explore a REST API)

## License

MIT
