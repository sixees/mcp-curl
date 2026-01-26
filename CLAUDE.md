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
- Graceful shutdown closes all sessions on SIGINT/SIGTERM

### Large Response Handling

Responses are processed in stages:

1. cURL fetches response (max 10MB processing limit)
2. `jq_filter` extracts specific data if provided:
   - Dot notation for arrays: `.results.0` same as `.results[0]`
   - Multiple paths: `.name,.email` returns array (max 20 paths)
   - Validation: unclosed quotes/brackets, leading zeros, safe integer bounds
3. If result exceeds `max_result_size` (default 500KB), auto-saves to file
4. Output directory priority: `output_dir` param > `MCP_CURL_OUTPUT_DIR` env > system temp
5. Temp files use secure permissions (0o700/0o600) and are cleaned on shutdown

### jq_query Tool

Query saved JSON files without new HTTP requests:

- Only allows files in: temp directory, `MCP_CURL_OUTPUT_DIR`, or current working directory
- **Note**: cwd access includes ALL subdirectories - be aware of what files exist in the server's working directory
- 10MB file size limit (same as curl response limit)
- Supports same jq_filter syntax as curl_execute

### Security Constraints

- Only structured `curl_execute` and `jq_query` tools (no arbitrary command execution)
- Commands executed via `spawn()` without shell (prevents injection)
- SSRF protection: blocks private IPs, IPv4-mapped IPv6, internal TLDs; DNS rebinding prevented via `--resolve`
- Localhost: blocked by default; `MCP_CURL_ALLOW_LOCALHOST=true` enables with port restrictions (80, 443, >1024)
- Rate limiting: 60/min per host + 300/min per client (dual limits prevent bypass)
- CRLF injection protection: validates headers, user-agent, auth values
- Uses `--data-raw` and `--form-string` to prevent file exfiltration via `@` prefix
- `jq_query` file access restricted to temp dir, `MCP_CURL_OUTPUT_DIR`, and cwd (including all subdirectories)
- **Symlink handling**: All paths resolved via `realpath()` before validation - symlinks are followed to their actual destination
- `output_dir` validation: must exist, be writable, no path traversal (`..`), symlinks resolved
- Max response/file size for processing: 10MB
- Max result size for inline return: 1MB (default 500KB)
- Max jq_filter paths: 20 comma-separated expressions
- Default timeout: 30 seconds
- SSL verification enabled by default

## Code Style

- Modern ES6+ with strict TypeScript
- ESM modules (`"type": "module"` in package.json)
- Zod for runtime schema validation
- Prefer async/await, pure functions, early returns
- Cross-platform: uses `path.isAbsolute()`, `path.basename()`, `path.resolve()` for Windows/Unix compatibility
