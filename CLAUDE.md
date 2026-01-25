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
- `executeCommand()` - Spawns cURL process with size limits
- `buildCurlArgs()` - Converts structured params to cURL CLI arguments
- `runStdio()` / `runHTTP()` - Transport-specific startup

### HTTP Transport Sessions

The HTTP transport uses proper session management:

- `sessions` Map tracks active sessions by ID
- Each session has its own McpServer instance
- POST creates/reuses sessions, GET handles SSE, DELETE terminates
- Graceful shutdown closes all sessions on SIGINT/SIGTERM

### Security Constraints

- Only structured `curl_execute` (no arbitrary command execution)
- Commands executed via `spawn()` without shell (prevents injection)
- Max response size: 4MB for both stdout and stderr
- Default timeout: 30 seconds
- SSL verification enabled by default

## Code Style

- Modern ES6+ with strict TypeScript
- ESM modules (`"type": "module"` in package.json)
- Zod for runtime schema validation
- Prefer async/await, pure functions, early returns
