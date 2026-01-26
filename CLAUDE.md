# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm start            # Run the server (stdio transport)
TRANSPORT=http PORT=3000 npm start  # Run with HTTP transport
```

## Architecture

This is an MCP (Model Context Protocol) server that enables LLMs to execute cURL commands. Single-file TypeScript
implementation in `src/index.ts`.

### Key Components

- **McpServer**: Core server from `@modelcontextprotocol/sdk` handling MCP protocol
- **Tool**: `curl_execute` - Structured HTTP requests with typed parameters
- **Resources**: `curl://docs/api` - Built-in API documentation
- **Prompts**: `api-test`, `api-discovery` - Reusable prompt templates
- **Transports**: Stdio (default) or HTTP via Express with session management

### Code Organization

- `createServer()` - Factory function for MCP server instances
- `registerToolsAndResources(server)` - Registers tool, resources, and prompts
- `executeCommand()` - Spawns cURL process with size limits and timeout handling
- `buildCurlArgs()` - Converts structured params to cURL CLI arguments
- `processResponse()` - Handles jq filtering, size limits, and file saving
- `applyJqFilter()` / `parseJqFilter()` - JSON path extraction (jq-like syntax)
- `runStdio()` / `runHTTP()` - Transport-specific startup

### HTTP Transport Sessions

The HTTP transport uses proper session management:

- `sessions` Map tracks active sessions by ID (max 100 concurrent)
- Each session has its own McpServer instance
- POST creates/reuses sessions, GET handles SSE, DELETE terminates
- Graceful shutdown closes all sessions on SIGINT/SIGTERM

### Large Response Handling

Responses are processed in stages:
1. cURL fetches response (max 10MB processing limit)
2. `jq_filter` extracts specific data if provided
3. If result exceeds `max_result_size` (default 500KB), auto-saves to temp file
4. Temp files use secure permissions (0o700/0o600) and are cleaned on shutdown

### Security Constraints

- Only structured `curl_execute` (no arbitrary command execution)
- Commands executed via `spawn()` without shell (prevents injection)
- SSRF protection: blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x), link-local, internal TLDs
- Rate limiting: 60 requests per minute per target host
- CRLF injection protection: validates headers, user-agent, auth values
- Uses `--data-raw` and `--form-string` to prevent file exfiltration via `@` prefix
- Max response size for processing: 10MB
- Max result size for inline return: 1MB (default 500KB)
- Default timeout: 30 seconds
- SSL verification enabled by default

## Code Style

- Modern ES6+ with strict TypeScript
- ESM modules (`"type": "module"` in package.json)
- Zod for runtime schema validation
- Prefer async/await, pure functions, early returns
