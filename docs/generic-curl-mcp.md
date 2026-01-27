# mcp-curl Refactoring Plan: Generic API Base Library

## Overview

Transform the monolithic `src/index.ts` (2,390 lines) into a modular, extensible base library that can be used to build specialized API MCP servers for any API (PageSpeed, Stripe, GitHub, etc.).

### Goals
1. **SRP**: Each file/module has a single, clear responsibility
2. **DRY**: Shared utilities extracted and reusable
3. **Extensible**: Base library can be imported and extended for any API
4. **API Definitions**: Support YAML/JSON schema files for declarative API definitions
5. **Backward Compatible**: Current CLI functionality preserved throughout

### Key Architectural Decisions
- **Pattern**: Composition with Builder (not inheritance) for flexibility
- **Hooks**: Request/response middleware chain for custom processing
- **Tool Registry**: Pluggable tool registration for custom/generated tools
- **API Schema**: YAML-based declarative endpoint definitions

---

## Progress Tracking

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ⬜ Not Started | Foundation - Types, Constants, Configuration |
| 2 | ⬜ Not Started | Core Utilities - Security, JQ, Files |
| 3 | ⬜ Not Started | Execution Layer - cURL, Response Processing |
| 4 | ⬜ Not Started | Server Components - Tools, Resources, Transports |
| 5 | ⬜ Not Started | Extension System - McpCurlServer Class, Hooks |
| 6 | ⬜ Not Started | API Schema System - YAML Loader, Tool Generator |
| 7 | ⬜ Not Started | Documentation & Examples |

---

## Phase 1: Foundation - Types, Constants, Configuration

**Goal**: Extract all types, interfaces, and constants into dedicated modules. This creates the foundation with zero internal dependencies.

### Files to Create

```
src/
├── lib/
│   ├── config/
│   │   ├── index.ts          # Barrel export
│   │   └── constants.ts      # All constants
│   └── types/
│       ├── index.ts          # Barrel export
│       ├── common.ts         # Shared types (generateMetadataSeparator)
│       ├── session.ts        # Session interface
│       ├── rate-limit.ts     # RateLimitEntry interface
│       ├── jq.ts             # JqToken type
│       └── response.ts       # UrlValidationResult, ProcessResponseOptions, etc.
```

### Extract from index.ts

| Source Lines | Target File | Content |
|--------------|-------------|---------|
| 15-29 | `config/constants.ts` | MAX_RESPONSE_SIZE, DEFAULT_TIMEOUT, SERVER_NAME, etc. |
| 25-27 | `types/common.ts` | generateMetadataSeparator() |
| 32-36 | `types/session.ts` | Session interface |
| 39-42, 71-82 | `config/constants.ts` | Session/rate limit constants |
| 79-82 | `types/rate-limit.ts` | RateLimitEntry interface |
| 992-996 | `types/jq.ts` | JqToken type |
| 731-735, 1450-1464 | `types/response.ts` | UrlValidationResult, ProcessResponseOptions, ProcessedResponse |
| 579, 601-688 | `config/constants.ts` | UUID_REGEX, BLOCKED_* patterns, LOCALHOST_* patterns |

### Verification
- [ ] `npm run build` succeeds
- [ ] `npm start` runs server correctly
- [ ] Types are exported from `lib/types/index.ts`
- [ ] Constants are exported from `lib/config/index.ts`

---

## Phase 2: Core Utilities - Security, JQ, Files

**Goal**: Extract stateless utility functions into dedicated modules.

### Files to Create

```
src/
├── lib/
│   ├── security/
│   │   ├── index.ts              # Barrel export
│   │   ├── ssrf.ts               # URL validation, DNS resolution
│   │   ├── rate-limiter.ts       # Rate limiting logic
│   │   ├── input-validation.ts   # CRLF, session ID validation
│   │   └── file-validation.ts    # File path validation
│   ├── jq/
│   │   ├── index.ts              # Barrel export
│   │   ├── tokenizer.ts          # parseBracketToken
│   │   ├── parser.ts             # parseJqFilter, splitJqFilters
│   │   └── filter.ts             # applySingleJqFilter, applyJqFilter
│   └── files/
│       ├── index.ts              # Barrel export
│       ├── temp-manager.ts       # Temp directory lifecycle
│       └── output-dir.ts         # Output directory validation
```

### Extract from index.ts

| Source Lines | Target File | Content |
|--------------|-------------|---------|
| 581-593 | `security/input-validation.ts` | isValidSessionId, validateNoCRLF |
| 698-818 | `security/ssrf.ts` | resolveDns, validateUrlAndResolveDns, isLocalhost*, isBlocked* |
| 88-150 | `security/rate-limiter.ts` | checkRateLimits, rate limit maps |
| 304-408 | `security/file-validation.ts` | validateFilePath |
| 999-1102 | `jq/tokenizer.ts` | parseBracketToken |
| 1111-1174, 1183-1296 | `jq/parser.ts` | parseJqFilter, splitJqFilters |
| 1177-1179, 1299-1394 | `jq/filter.ts` | isRecord, applySingleJqFilter, applyJqFilter |
| 156-202 | `files/temp-manager.ts` | getOrCreateTempDir, cleanupOrphanedTempDirs |
| 208-285 | `files/output-dir.ts` | resolveOutputDir, validateOutputDir |

### Verification
- [ ] All security functions work independently
- [ ] JQ filtering works with same test cases
- [ ] File operations maintain security constraints
- [ ] `npm run build && npm start` works

---

## Phase 3: Execution Layer - cURL, Response Processing

**Goal**: Extract cURL execution and response handling.

### Files to Create

```
src/
├── lib/
│   ├── execution/
│   │   ├── index.ts              # Barrel export
│   │   ├── command-executor.ts   # executeCommand with memory tracking
│   │   └── curl-args-builder.ts  # buildCurlArgs
│   └── response/
│       ├── index.ts              # Barrel export
│       ├── parser.ts             # isJsonContentType, parseResponseWithMetadata
│       ├── formatter.ts          # formatResponse
│       ├── file-saver.ts         # createSafeFilenameBase, saveResponseToFile
│       └── processor.ts          # processResponse (orchestration)
```

### Extract from index.ts

| Source Lines | Target File | Content |
|--------------|-------------|---------|
| 475-576 | `execution/command-executor.ts` | executeCommand, memory tracking |
| 822-950 | `execution/curl-args-builder.ts` | buildCurlArgs |
| 411-438 | `response/parser.ts` | isJsonContentType, parseResponseWithMetadata |
| 441-454 | `response/parser.ts` | sanitizeErrorMessage |
| 953-989 | `response/formatter.ts` | formatResponse |
| 1396-1447 | `response/file-saver.ts` | createSafeFilenameBase, saveResponseToFile |
| 1466-1525 | `response/processor.ts` | processResponse |

### Verification
- [ ] cURL execution works with all parameter combinations
- [ ] Response processing handles large files correctly
- [ ] JQ filtering integration works
- [ ] Memory limits enforced

---

## Phase 4: Server Components - Tools, Resources, Transports

**Goal**: Extract MCP registration and transport implementations.

### Files to Create

```
src/
├── lib/
│   ├── server/
│   │   ├── index.ts              # Barrel export
│   │   ├── server-factory.ts     # createServer
│   │   ├── schemas.ts            # CurlExecuteSchema, JqQuerySchema
│   │   └── lifecycle.ts          # shutdown, signal handlers
│   └── session/
│       ├── index.ts              # Barrel export
│       └── session-manager.ts    # sessions Map, cleanup
├── tools/
│   ├── index.ts                  # Barrel export
│   ├── curl-execute.ts           # curl_execute tool handler
│   └── jq-query.ts               # jq_query tool handler
├── resources/
│   ├── index.ts                  # Barrel export
│   └── documentation.ts          # API docs resource
├── prompts/
│   ├── index.ts                  # Barrel export
│   ├── api-test.ts               # api-test prompt
│   └── api-discovery.ts          # api-discovery prompt
└── transports/
    ├── index.ts                  # Barrel export
    ├── stdio.ts                  # runStdio
    └── http.ts                   # runHTTP, auth middleware
```

### Extract from index.ts

| Source Lines | Target File | Content |
|--------------|-------------|---------|
| 1528-1629 | `server/schemas.ts` | CurlExecuteSchema, JqQuerySchema, types |
| 457-462 | `server/server-factory.ts` | createServer |
| 2148-2186 | `server/lifecycle.ts` | shutdown, signal handlers |
| 31-60 | `session/session-manager.ts` | sessions Map, cleanup interval |
| 1719-1801 | `tools/curl-execute.ts` | curl_execute handler |
| 1850-1912 | `tools/jq-query.ts` | jq_query handler |
| 1916-2078 | `resources/documentation.ts` | API docs |
| 2081-2141 | `prompts/*.ts` | api-test, api-discovery |
| 2189-2199 | `transports/stdio.ts` | runStdio |
| 2213-2376 | `transports/http.ts` | runHTTP, auth middleware |

### Update index.ts
After this phase, `src/index.ts` becomes a thin entry point:

```typescript
// src/index.ts - Entry point only
import { runStdio } from "./transports/stdio.js";
import { runHTTP } from "./transports/http.js";
import { registerShutdownHandlers } from "./lib/server/lifecycle.js";

registerShutdownHandlers();

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") {
  runHTTP().catch(console.error);
} else {
  runStdio().catch(console.error);
}
```

### Verification
- [ ] CLI still works: `npm start`
- [ ] HTTP transport works: `TRANSPORT=http npm start`
- [ ] All tools respond correctly
- [ ] Session management works
- [ ] Graceful shutdown works

---

## Phase 5: Extension System - McpCurlServer Class, Hooks

**Goal**: Create the main extensible server class with hooks and tool registration.

### Files to Create

```
src/
├── McpCurlServer.ts              # Main extensible server class
├── types/
│   └── public.ts                 # Public API types for consumers
└── lib/
    └── index.ts                  # Library barrel export
```

### McpCurlServer API

```typescript
export class McpCurlServer {
  constructor(config?: McpCurlConfig);

  // Configuration
  configure(config: Partial<McpCurlConfig>): this;
  getConfig(): Readonly<McpCurlConfig>;

  // Hooks
  beforeRequest(hook: BeforeRequestHook): this;
  afterResponse(hook: AfterResponseHook): this;
  onError(hook: OnErrorHook): this;

  // Custom Tools
  registerTool<T extends z.ZodObject<any>>(definition: CustomToolDefinition<T>): this;
  disableCurlExecute(): this;
  disableJqQuery(): this;

  // Utilities (static)
  static get utilities(): CurlUtilities;

  // Lifecycle
  async start(transport?: "stdio" | "http"): Promise<void>;
  getMcpServer(): McpServer;
}
```

### Configuration Interface

```typescript
export interface McpCurlConfig {
  name?: string;
  version?: string;
  baseUrl?: string;                          // Prepended to relative URLs
  defaultHeaders?: Record<string, string>;   // Added to all requests
  defaultTimeout?: number;
  maxResponseSize?: number;
  maxResultSize?: number;
  outputDir?: string;
  allowLocalhost?: boolean;
  rateLimits?: { perHost?: number; perClient?: number };
  authToken?: string;                        // For HTTP transport
}
```

### Hook Types

```typescript
export interface RequestHookContext {
  server: McpServer;
  config: McpCurlConfig;
  originalUrl: string;
  method: string;
  headers: Record<string, string>;  // Mutable
  data?: string;
  form?: Record<string, string>;
}

export type BeforeRequestHook = (ctx: RequestHookContext) => Promise<RequestHookContext | void>;
export type AfterResponseHook = (ctx: ResponseHookContext) => Promise<string | void>;
export type OnErrorHook = (error: Error, ctx: HookContext) => Promise<Error | void>;
```

### Verification
- [ ] Can create server: `new McpCurlServer()`
- [ ] Can configure: `.configure({ baseUrl: "..." })`
- [ ] Can add hooks: `.beforeRequest(async ctx => { ... })`
- [ ] Can register tools: `.registerTool({ name: "...", ... })`
- [ ] Can disable defaults: `.disableCurlExecute()`
- [ ] Can start: `await server.start("stdio")`

---

## Phase 6: API Schema System - YAML Loader, Tool Generator

**Goal**: Support declarative API definitions via YAML files.

### Files to Create

```
src/
├── schema/
│   ├── index.ts                  # Barrel export
│   ├── types.ts                  # Schema type definitions
│   ├── validator.ts              # Zod schema for validation
│   ├── loader.ts                 # YAML/JSON loader
│   └── generator.ts              # Tool generator from schema
└── api-server.ts                 # Factory for schema-based servers
```

### API Schema Format (YAML)

```yaml
apiVersion: "1.0"

api:
  name: "my-api"
  title: "My API"
  description: "Description for LLM context"
  version: "1.0"
  baseUrl: "https://api.example.com/v1"

auth:
  apiKey:
    type: "query"           # "query" | "header"
    name: "key"
    envVar: "MY_API_KEY"
    required: true

defaults:
  timeout: 30
  headers:
    Accept: "application/json"

endpoints:
  - id: "get_item"
    path: "/items/{id}"
    method: "GET"
    title: "Get Item"
    description: "Fetch an item by ID"
    parameters:
      - name: "id"
        in: "path"
        type: "string"
        required: true
        description: "Item ID"
    response:
      jqFilter: ".data"
      filterPresets:
        - name: "summary"
          jqFilter: "{id: .data.id, name: .data.name}"
```

### API Server Factory

```typescript
export async function createApiServer(options: {
  definitionPath: string;
  config?: Partial<McpCurlConfig>;
  customTools?: CustomToolDefinition<any>[];
  beforeRequest?: BeforeRequestHook;
  afterResponse?: AfterResponseHook;
}): Promise<McpCurlServer>;
```

### Verification
- [ ] Can load YAML definition
- [ ] Validates schema correctly
- [ ] Generates tools from endpoints
- [ ] Auth injection works
- [ ] Parameter mapping works (query, path, header, body)
- [ ] Response filtering works
- [ ] Filter presets work

---

## Phase 7: Documentation & Examples

**Goal**: Comprehensive documentation and working examples.

### Files to Create

```
docs/
├── README.md                     # Library overview
├── getting-started.md            # Quick start guide
├── configuration.md              # Config options reference
├── custom-tools.md               # Writing custom tools
├── hooks.md                      # Hook patterns and examples
├── api-schema.md                 # YAML schema reference
└── migration.md                  # Upgrading from v1.x

examples/
├── basic/                        # Minimal custom server
├── github-api/                   # GitHub API example
├── stripe-api/                   # Stripe API example
├── with-hooks/                   # Hook patterns
└── from-yaml/                    # YAML-based definition
```

### Package.json Updates

```json
{
  "name": "mcp-curl",
  "version": "2.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./lib": {
      "import": "./dist/lib/index.js",
      "types": "./dist/lib/index.d.ts"
    },
    "./schema": {
      "import": "./dist/schema/index.js",
      "types": "./dist/schema/index.d.ts"
    }
  },
  "bin": {
    "curl-mcp": "./dist/cli.js"
  },
  "files": ["dist/", "docs/"]
}
```

### Verification
- [ ] All examples run successfully
- [ ] Documentation is accurate
- [ ] Types are exported correctly
- [ ] Package installs and works from npm

---

## Final Directory Structure

```
mcp-curl/
├── src/
│   ├── index.ts                      # CLI entry point
│   ├── cli.ts                        # CLI wrapper (for bin)
│   ├── McpCurlServer.ts              # Main extensible class
│   ├── api-server.ts                 # Schema-based server factory
│   ├── lib/
│   │   ├── index.ts                  # Library exports
│   │   ├── config/
│   │   │   ├── index.ts
│   │   │   └── constants.ts
│   │   ├── types/
│   │   │   ├── index.ts
│   │   │   ├── common.ts
│   │   │   ├── session.ts
│   │   │   ├── rate-limit.ts
│   │   │   ├── jq.ts
│   │   │   └── response.ts
│   │   ├── security/
│   │   │   ├── index.ts
│   │   │   ├── ssrf.ts
│   │   │   ├── rate-limiter.ts
│   │   │   ├── input-validation.ts
│   │   │   └── file-validation.ts
│   │   ├── jq/
│   │   │   ├── index.ts
│   │   │   ├── tokenizer.ts
│   │   │   ├── parser.ts
│   │   │   └── filter.ts
│   │   ├── files/
│   │   │   ├── index.ts
│   │   │   ├── temp-manager.ts
│   │   │   └── output-dir.ts
│   │   ├── execution/
│   │   │   ├── index.ts
│   │   │   ├── command-executor.ts
│   │   │   └── curl-args-builder.ts
│   │   ├── response/
│   │   │   ├── index.ts
│   │   │   ├── parser.ts
│   │   │   ├── formatter.ts
│   │   │   ├── file-saver.ts
│   │   │   └── processor.ts
│   │   ├── server/
│   │   │   ├── index.ts
│   │   │   ├── server-factory.ts
│   │   │   ├── schemas.ts
│   │   │   └── lifecycle.ts
│   │   └── session/
│   │       ├── index.ts
│   │       └── session-manager.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── curl-execute.ts
│   │   └── jq-query.ts
│   ├── resources/
│   │   ├── index.ts
│   │   └── documentation.ts
│   ├── prompts/
│   │   ├── index.ts
│   │   ├── api-test.ts
│   │   └── api-discovery.ts
│   ├── transports/
│   │   ├── index.ts
│   │   ├── stdio.ts
│   │   └── http.ts
│   ├── schema/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── validator.ts
│   │   ├── loader.ts
│   │   └── generator.ts
│   └── types/
│       └── public.ts                 # Public API types
├── docs/
│   └── generic-curl-mcp.md           # This plan
├── examples/
│   ├── basic/
│   ├── github-api/
│   ├── stripe-api/
│   ├── with-hooks/
│   └── from-yaml/
├── dist/                             # Compiled output
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

---

## Consumer Usage Examples

### 1. Basic Extension

```typescript
import { McpCurlServer } from "mcp-curl";
import { z } from "zod";

const server = new McpCurlServer({
  name: "my-api-server",
  baseUrl: "https://api.example.com/v1",
});

server.registerTool({
  name: "get_user",
  title: "Get User",
  description: "Fetch user by ID",
  inputSchema: z.object({
    id: z.string().describe("User ID"),
  }),
  handler: async (params, ctx) => {
    const { validateUrlAndResolveDns, buildCurlArgs, executeCommand } =
      McpCurlServer.utilities;
    // ... implementation
  },
});

server.start();
```

### 2. From YAML Schema

```typescript
import { createApiServer } from "mcp-curl/schema";

const server = await createApiServer({
  definitionPath: "./my-api.yaml",
});

server.start();
```

### 3. With Hooks

```typescript
const server = new McpCurlServer();

server.beforeRequest(async (ctx) => {
  ctx.headers["Authorization"] = `Bearer ${await getToken()}`;
  return ctx;
});

server.afterResponse(async (ctx) => {
  // Unwrap API envelope
  const data = JSON.parse(ctx.body);
  return JSON.stringify(data.result);
});

server.start();
```

---

## Testing Strategy

### Per-Phase Testing
Each phase must pass these tests before proceeding:

1. **Build**: `npm run build` succeeds
2. **CLI**: `npm start` runs stdio server
3. **HTTP**: `TRANSPORT=http npm start` runs HTTP server
4. **Tools**: Both `curl_execute` and `jq_query` work correctly
5. **Security**: SSRF protection, rate limiting, file validation work

### Integration Tests (After Phase 5+)
- Create custom server with registered tool
- Verify hooks are called in order
- Verify configuration is applied
- Test tool disable functionality

### Schema Tests (After Phase 6)
- Load and validate sample YAML
- Generate tools from endpoints
- Verify auth injection
- Verify parameter mapping

---

## Dependencies to Add

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0"  // For YAML schema loading
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9"
  }
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing users | Maintain backward-compatible CLI entry point |
| Circular dependencies | Strict layered architecture with barrel exports |
| Type export issues | Test imports from consuming project after each phase |
| Memory leaks from hooks | Document hook cleanup requirements |
| Schema versioning | Include `apiVersion` field for future changes |

---

## Success Criteria

1. ✅ Existing CLI works identically to v1.x
2. ✅ Can import and extend as library
3. ✅ Can create API-specific servers from YAML
4. ✅ All security features preserved
5. ✅ Types exported for TypeScript consumers
6. ✅ Documentation complete with examples