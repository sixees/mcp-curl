# mcp-curl Refactoring Plan: Generic API Base Library

## Overview

Transform the monolithic `src/index.ts` (2,390 lines) into a modular, extensible base library that can be used to build
specialized API MCP servers for any API (PageSpeed, Stripe, GitHub, etc.).

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

| Phase | Status        | Description                                      |
|-------|---------------|--------------------------------------------------|
| 1     | ✅ Complete    | Foundation - Types, Constants, Configuration     |
| 2     | ✅ Complete    | Core Utilities - Security, JQ, Files             |
| 3     | ✅ Complete    | Execution Layer - cURL, Response Processing      |
| 4     | ✅ Complete    | Server Components - Tools, Resources, Transports |
| 5     | ✅ Complete    | Extension System - McpCurlServer Class, Hooks    |
| 6     | ⬜ Not Started | API Schema System - YAML Loader, Tool Generator  |
| 7     | ⬜ Not Started | Documentation & Examples                         |

---

## Phase 1: Foundation - Types, Constants, Configuration

**Goal**: Extract all types, interfaces, and constants into dedicated modules. This creates the foundation with zero
internal dependencies.

### Design Principle: Separation of Concerns

Constants are split by domain rather than in a single file. This follows SRP and makes it easier to:

- Find related configuration in one place
- Understand what each module controls
- Test domain-specific behavior in isolation

**Key distinction from Phase 2:**

- `config/security/` contains **pure predicate functions** and patterns (no I/O, no state)
- `lib/security/` (Phase 2) contains **stateful functions** (DNS resolution, rate limit maps, file system access)

### Design Patterns

**Immutability for Security-Critical Data:**

- Private arrays with `Object.freeze()`: `const PATTERNS_INTERNAL: readonly RegExp[] = Object.freeze([...])`
- Private Sets with `Object.freeze()`: `const ALLOWED_PORTS: ReadonlySet<number> = Object.freeze(new Set([...]))`
- Exported pure predicate functions instead of raw patterns: `isBlockedHostname()`, `isAllowedLocalhostPort()`
- This prevents runtime mutation that could weaken security

**Type Design:**

- `as const` objects for grouped configuration (provides literal type inference)
- Discriminated unions for result types with mutually exclusive fields (e.g., `ProcessedResponse`)
- `export type *` for modules containing only types (reduces runtime code)
- Field-level JSDoc comments on interface properties for documentation

### Files to Create

```text
src/
├── lib/
│   ├── config/
│   │   ├── index.ts           # Barrel export (re-exports all config modules)
│   │   ├── limits.ts          # Response sizes, timeouts, file size limits
│   │   ├── server.ts          # Server identity (name, version)
│   │   ├── session.ts         # Session management & rate-limit window constants
│   │   ├── jq.ts              # JQ filter DoS prevention limits
│   │   ├── environment.ts     # Environment variable names
│   │   └── security/
│   │       ├── index.ts       # Barrel export for security config
│   │       ├── ssrf.ts        # SSRF patterns + pure predicate functions
│   │       └── validation.ts  # Input validation patterns (UUID_REGEX)
│   └── types/
│       ├── index.ts           # Barrel export (type-only for most)
│       ├── common.ts          # generateMetadataSeparator()
│       ├── session.ts         # Session interface
│       ├── rate-limit.ts      # RateLimitEntry interface
│       ├── jq.ts              # JqToken type
│       └── response.ts        # UrlValidationResult, ProcessResponseOptions, ProcessedResponse
```

### Module Responsibilities

| Module                          | Contents                                                                  |
|---------------------------------|---------------------------------------------------------------------------|
| `config/limits.ts`              | MAX_RESPONSE_SIZE, DEFAULT_TIMEOUT, FILENAME_MAX_LENGTH, etc.             |
| `config/server.ts`              | SERVER_NAME, SERVER_VERSION                                               |
| `config/session.ts`             | MAX_SESSIONS, SESSION_IDLE_TIMEOUT_MS, RATE_LIMIT_*, TEMP_DIR_PREFIX      |
| `config/jq.ts`                  | MAX_JQ_FILTER_LENGTH, MAX_JQ_TOKENS, MAX_JQ_FILTERS, MAX_JQ_PARSE_TIME_MS |
| `config/environment.ts`         | OUTPUT_DIR_ENV_VAR, ALLOW_LOCALHOST_ENV_VAR, HTTP_AUTH_TOKEN_ENV_VAR      |
| `config/security/ssrf.ts`       | SSRF patterns (private) + isBlockedHostname(), isLocalhostIp(), etc.      |
| `config/security/validation.ts` | UUID_REGEX, isWindowsReservedBasename()                                   |

### Verification

- [x] `npm run build` succeeds
- [x] `npm start` runs server correctly
- [x] Types are exported from `lib/types/index.ts`
- [x] Constants are exported from `lib/config/index.ts`
- [x] Security predicates are pure functions (no I/O dependencies)
- [x] All security-critical arrays AND sets are frozen with `Object.freeze()`
- [x] `ProcessedResponse` uses discriminated union (filepath only when savedToFile=true)
- [x] All interface fields have JSDoc documentation

---

## Phase 2: Core Utilities - Security, JQ, Files

**Goal**: Extract stateful utility functions into dedicated modules.

### Design Principle: Stateful vs Pure

This phase extracts functions that have **side effects or state**:

- DNS resolution (network I/O)
- Rate limiting (stateful maps)
- File system access (I/O)
- Environment variable reads

Pure predicate functions (pattern matching) remain in `config/security/` from Phase 1.

### Files to Create

```text
src/
├── lib/
│   ├── security/
│   │   ├── index.ts              # Barrel export
│   │   ├── ssrf.ts               # DNS resolution, validateUrlAndResolveDns, isLocalhostAllowed
│   │   ├── rate-limiter.ts       # Rate limiting logic with stateful maps
│   │   ├── input-validation.ts   # CRLF, session ID validation
│   │   └── file-validation.ts    # File path validation (fs access)
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

### Module Responsibilities

| Module                         | Type     | Contents                                              |
|--------------------------------|----------|-------------------------------------------------------|
| `security/ssrf.ts`             | Stateful | resolveDns (DNS I/O), validateUrlAndResolveDns        |
| `security/rate-limiter.ts`     | Stateful | checkRateLimits, hostRateLimitMap, clientRateLimitMap |
| `security/input-validation.ts` | Pure     | isValidSessionId, validateNoCRLF                      |
| `security/file-validation.ts`  | Stateful | validateFilePath (fs access, realpath)                |
| `jq/tokenizer.ts`              | Pure     | parseBracketToken                                     |
| `jq/parser.ts`                 | Pure     | parseJqFilter, splitJqFilters                         |
| `jq/filter.ts`                 | Pure     | isRecord, applySingleJqFilter, applyJqFilter          |
| `files/temp-manager.ts`        | Stateful | getOrCreateTempDir, cleanupOrphanedTempDirs           |
| `files/output-dir.ts`          | Stateful | resolveOutputDir, validateOutputDir                   |

**Note:** `lib/security/ssrf.ts` imports predicates from `config/security/ssrf.ts`:

- `isBlockedHostname()`, `isLocalhostHostname()` - hostname pattern matching
- `isBlockedIp()`, `isLocalhostIp()` - IP pattern matching
- `isAllowedLocalhostPort()` - port validation

### Verification

- [x] All security functions work independently
- [x] JQ filtering works with same test cases
- [x] File operations maintain security constraints
- [x] `npm run build && npm start` works

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

| Source Lines | Target File                      | Content                                      |
|--------------|----------------------------------|----------------------------------------------|
| 475-576      | `execution/command-executor.ts`  | executeCommand, memory tracking              |
| 822-950      | `execution/curl-args-builder.ts` | buildCurlArgs                                |
| 411-438      | `response/parser.ts`             | isJsonContentType, parseResponseWithMetadata |
| 441-454      | `response/parser.ts`             | sanitizeErrorMessage                         |
| 953-989      | `response/formatter.ts`          | formatResponse                               |
| 1396-1447    | `response/file-saver.ts`         | createSafeFilenameBase, saveResponseToFile   |
| 1466-1525    | `response/processor.ts`          | processResponse                              |

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

| Source Lines | Target File                  | Content                                 |
|--------------|------------------------------|-----------------------------------------|
| 1528-1629    | `server/schemas.ts`          | CurlExecuteSchema, JqQuerySchema, types |
| 457-462      | `server/server-factory.ts`   | createServer                            |
| 2148-2186    | `server/lifecycle.ts`        | shutdown, signal handlers               |
| 31-60        | `session/session-manager.ts` | sessions Map, cleanup interval          |
| 1719-1801    | `tools/curl-execute.ts`      | curl_execute handler                    |
| 1850-1912    | `tools/jq-query.ts`          | jq_query handler                        |
| 1916-2078    | `resources/documentation.ts` | API docs                                |
| 2081-2141    | `prompts/*.ts`               | api-test, api-discovery                 |
| 2189-2199    | `transports/stdio.ts`        | runStdio                                |
| 2213-2376    | `transports/http.ts`         | runHTTP, auth middleware                |

### Update index.ts

After this phase, `src/index.ts` becomes a thin entry point:

```typescript
// src/index.ts - Entry point only
import {runStdio} from "./transports/stdio.js";
import {runHTTP} from "./transports/http.js";
import {registerShutdownHandlers} from "./lib/server/lifecycle.js";

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
  "files": [
    "dist/",
    "docs/"
  ]
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
│   │   │   ├── index.ts              # Barrel export
│   │   │   ├── limits.ts             # Response sizes, timeouts
│   │   │   ├── server.ts             # Server identity
│   │   │   ├── session.ts            # Session & rate-limit constants
│   │   │   ├── jq.ts                 # JQ filter limits
│   │   │   ├── environment.ts        # Env var names
│   │   │   └── security/
│   │   │       ├── index.ts          # Security config barrel
│   │   │       ├── ssrf.ts           # SSRF patterns + predicates
│   │   │       └── validation.ts     # Input validation patterns
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
import {McpCurlServer} from "mcp-curl";
import {z} from "zod";

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
        const {validateUrlAndResolveDns, buildCurlArgs, executeCommand} =
            McpCurlServer.utilities;
        // ... implementation
    },
});

server.start();
```

### 2. From YAML Schema

```typescript
import {createApiServer} from "mcp-curl/schema";

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
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9"
  }
}
```

---

## Risk Mitigation

| Risk                    | Mitigation                                           |
|-------------------------|------------------------------------------------------|
| Breaking existing users | Maintain backward-compatible CLI entry point         |
| Circular dependencies   | Strict layered architecture with barrel exports      |
| Type export issues      | Test imports from consuming project after each phase |
| Memory leaks from hooks | Document hook cleanup requirements                   |
| Schema versioning       | Include `apiVersion` field for future changes        |

---

## Success Criteria

1. ✅ Existing CLI works identically to v1.x
2. ✅ Can import and extend as library
3. ✅ Can create API-specific servers from YAML
4. ✅ All security features preserved
5. ✅ Types exported for TypeScript consumers
6. ✅ Documentation complete with examples