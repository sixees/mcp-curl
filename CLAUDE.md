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
- **Tools**: `curl_execute` (HTTP requests), `jq_query` (query saved JSON files)
- **Resources**: `curl://docs/api` - Built-in API documentation
- **Prompts**: `api-test`, `api-discovery` - Reusable prompt templates
- **Transports**: Stdio (default) or HTTP via Express with session management

### Code Organization

- `createServer()` - Factory function for MCP server instances
- `registerToolsAndResources(server)` - Registers tool, resources, and prompts
- `executeCommand()` - Spawns cURL process with size limits and timeout handling
- `buildCurlArgs()` - Converts structured params to cURL CLI arguments
- `processResponse()` - Handles jq filtering, size limits, and file saving
- `applyJqFilter()` / `applySingleJqFilter()` / `parseJqFilter()` - JSON path extraction (jq-like syntax)
- `splitJqFilters()` - Splits comma-separated jq filters respecting brackets/quotes with validation
- `resolveOutputDir()` / `validateOutputDir()` - Output directory resolution and validation
- `validateFilePath()` - Security validation for jq_query file access
- `runStdio()` / `runHTTP()` - Transport-specific startup

### HTTP Transport Sessions

The HTTP transport uses proper session management:

- `sessions` Map tracks active sessions by ID (max 100 concurrent)
- Each session has its own McpServer instance
- POST creates/reuses sessions, GET handles SSE, DELETE terminates
- Session idle timeout: 1 hour (cleanup runs every 5 minutes)
- Graceful shutdown closes all sessions on SIGINT/SIGTERM
- Optional authentication: `MCP_AUTH_TOKEN` env var enables bearer token requirement

### Large Response Handling

Responses are processed in stages:

1. cURL fetches response (max 10MB processing limit)
2. `jq_filter` extracts specific data if provided:
    - Dot notation for arrays: `.results.0` same as `.results[0]`
    - Multiple paths: `.name,.email` returns array (max 20 paths)
    - Validation: unclosed quotes/brackets, leading zeros, safe integer bounds
    - Note: negative indices not supported (e.g., `[-1]` for last element)
3. If result exceeds `max_result_size` (default 500KB), auto-saves to file
4. Output directory priority: `output_dir` param > `MCP_CURL_OUTPUT_DIR` env > system temp
5. Temp directories use 0o700, files use 0o600 (owner-only); cleaned on shutdown

### jq_query Tool

Query saved JSON files without new HTTP requests:

- Only allows files in: temp directory, `MCP_CURL_OUTPUT_DIR`, or current working directory
- **Note**: cwd access includes ALL subdirectories - be aware of what files exist in the server's working directory
- 10MB file size limit (same as curl response limit)
- Supports same jq_filter syntax as curl_execute

### Security Constraints

**Network Security:**

- SSRF protection: blocks private IPs (10.x, 172.16-31.x, 192.168.x, 169.254.x), IPv4-mapped IPv6, internal TLDs
- DNS rebinding prevention: DNS resolved before validation, cURL pinned to validated IP via `--resolve`
- Protocol whitelist: only `http://` and `https://` allowed; `file://`, `ftp://`, etc. blocked
- Windows UNC paths blocked (`\\server\share`)
- Localhost: blocked by default; `MCP_CURL_ALLOW_LOCALHOST=true` enables with port restrictions (80, 443, >1024)

**Rate Limiting:**

- Per-hostname: 60 requests/minute to any single host
- Per-client: 300 requests/minute total (prevents bypassing host limits via many hostnames)

**Input Validation:**

- Only structured `curl_execute` and `jq_query` tools (no arbitrary command execution)
- Commands executed via `spawn()` without shell (prevents injection)
- CRLF injection protection: validates headers, user-agent, auth values for newlines
- Uses `--data-raw` and `--form-string` to prevent file exfiltration via `@` prefix
- Per-request unique metadata separator prevents response injection attacks

**File Access:**

- `jq_query` restricted to: temp dir, `MCP_CURL_OUTPUT_DIR`, cwd (including subdirectories)
- **Symlink handling**: All paths resolved via `realpath()` before validation
- `output_dir` validation: must exist, be writable, no path traversal (`..`)

**Resource Limits:**

- Max response/file size for processing: 10MB
- Max result size for inline return: 1MB (default 500KB)
- Global memory limit: 100MB across all concurrent requests
- Max jq_filter paths: 20 comma-separated expressions
- JQ parsing timeout: 100ms (prevents ReDoS)
- Default request timeout: 30 seconds
- SSL verification enabled by default

**HTTP Transport:**

- Optional bearer token authentication via `MCP_AUTH_TOKEN` env var
- Session idle timeout: 1 hour (cleanup every 5 minutes)
- Max 100 concurrent sessions

## Code Style

- Modern ES6+ with strict TypeScript
- ESM modules (`"type": "module"` in package.json)
- Zod for runtime schema validation
- Prefer async/await, pure functions, early returns
- Cross-platform: uses `path.isAbsolute()`, `path.basename()`, `path.resolve()` for Windows/Unix compatibility
