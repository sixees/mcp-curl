# MCP SQL Proxy Server — Phase 1 Bootstrap Guide

**Date:** 2026-03-13
**Phase:** 1 of 7 — Foundation (Scaffold + Config + Profiles)
**Estimate:** 3 days
**Source project:** mcp-curl v2.0.1 (this repo)
**Parent plan:** [docs/plans/2026-03-12-feat-mcp-sql-proxy-server-plan.md](./2026-03-12-feat-mcp-sql-proxy-server-plan.md)

---

## Strategy

Start a clean project. Seed it with ~18 production-hardened generic files from mcp-curl, adapt ~9 files that need domain-specific changes, and write ~8 new SQL-specific files from scratch. This gives a working project skeleton with infrastructure (rate limiting, session management, file safety, error handling, transports, builder pattern) on day one.

**Do NOT fork mcp-curl.** Create a new repository with a fresh git history.

---

## Table of Contents

1. [Project Scaffold](#1-project-scaffold)
2. [Copy Generic Files Verbatim](#2-copy-generic-files-verbatim) (18 files)
3. [Adapt Files with Domain Changes](#3-adapt-files-with-domain-changes) (9 files)
4. [Create New SQL-Specific Files](#4-create-new-sql-specific-files) (8 files)
5. [Create Entry Points](#5-create-entry-points) (3 files)
6. [Create Barrel Exports](#6-create-barrel-exports)
7. [Testing](#7-testing)
8. [Verification Checklist](#8-verification-checklist)

---

## 1. Project Scaffold

### 1.1 Create the project directory and initialise

```bash
mkdir mcp-sql && cd mcp-sql
git init
npm init -y
```

### 1.2 `package.json`

Replace the generated `package.json` with:

```json
{
  "name": "mcp-sql",
  "version": "0.1.0",
  "description": "MCP server for proxying SQL queries to relational databases",
  "main": "dist/lib.js",
  "types": "dist/lib.d.ts",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/lib.d.ts",
      "import": "./dist/lib.js"
    },
    "./cli": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./lib": {
      "types": "./dist/lib/index.d.ts",
      "import": "./dist/lib/index.js"
    }
  },
  "bin": {
    "sql-mcp": "./dist/index.js"
  },
  "files": [
    "dist",
    "docs"
  ],
  "scripts": {
    "build": "tsup && node -e \"require('fs').chmodSync('dist/index.js', 0o755)\"",
    "prepublishOnly": "npm run build",
    "start": "node dist/index.js",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": [
    "mcp",
    "sql",
    "database",
    "mysql",
    "postgres",
    "mssql",
    "model-context-protocol",
    "claude"
  ],
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "express": "^4.21.0",
    "js-yaml": "^4.1.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.5.0",
    "tsup": "^8.5.1",
    "typescript": "^5.5.4",
    "vitest": "^4.0.18"
  }
}
```

> **Note:** Database driver dependencies (`mysql2`, `pg`, `mssql`) are NOT added in Phase 1. They arrive in Phase 2.

### 1.3 `tsconfig.json`

Copy verbatim from mcp-curl:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 1.4 `vitest.config.ts`

Copy verbatim from mcp-curl:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
});
```

### 1.5 `tsup.config.ts`

Adapt from mcp-curl — remove schema entry point, keep version injection:

```typescript
import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
    entry: {
        "index": "src/index.ts",
        "lib": "src/lib.ts",
        "lib/index": "src/lib/index.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    clean: true,
    dts: true,
    splitting: true,
    sourcemap: false,
    external: [
        "express",
        "zod",
        "@modelcontextprotocol/sdk",
        "js-yaml",
    ],
    define: {
        "__PACKAGE_VERSION__": JSON.stringify(pkg.version),
    },
});
```

### 1.6 `.gitignore`

```
node_modules/
dist/
*.tgz
.env
```

### 1.7 Create the directory structure

```bash
mkdir -p src/lib/{config/security,types,security,files,response,server,session,tools,resources,prompts,transports,profiles,extensible,utils}
```

---

## 2. Copy Generic Files Verbatim

These files are domain-agnostic infrastructure from mcp-curl. Copy each file into the corresponding path in mcp-sql. Only trivial renames needed (noted per file).

**Source:** `mcp-curl/src/lib/`
**Destination:** `mcp-sql/src/lib/`

### 2.1 `config/security/validation.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/config/security/validation.ts`
**Exports:** `UUID_REGEX`, `WINDOWS_RESERVED_BASENAMES`, `isWindowsReservedBasename()`
**Changes:** None. UUID validation and Windows filename safety are generic.

### 2.2 `config/security/blocked-dirs.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/config/security/blocked-dirs.ts`
**Exports:** `isBlockedSystemDirectory()`, `createBlockedDirectoryError()`
**Changes:** None. Cross-platform system directory blocklists are generic.

### 2.3 `types/rate-limit.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/types/rate-limit.ts`
**Exports:** `RateLimitEntry` interface
**Changes:** None.

### 2.4 `types/session.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/types/session.ts`
**Exports:** `Session` interface
**Changes:** None. HTTP session structure is identical.

### 2.5 `security/input-validation.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/security/input-validation.ts`
**Exports:** `safeStringCompare()`, `isValidSessionId()`, `validateNoCRLF()`
**Changes:** None. Timing-safe compare, UUID check, CRLF prevention are all generic.

### 2.6 `files/temp-manager.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/files/temp-manager.ts`
**Exports:** `getOrCreateTempDir()`, `getSharedTempDir()`, `cleanupOrphanedTempDirs()`, `cleanupTempDir()`
**Changes:** None. References `TEMP_DIR.PREFIX` which is updated in the session config (Section 3).

### 2.7 `files/output-dir.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/files/output-dir.ts`
**Exports:** `resolveOutputDir()`, `validateOutputDir()`
**Changes:** None. The env var constant it references (`ENV.OUTPUT_DIR`) is updated in Section 3.

### 2.8 `server/server-factory.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/server/server-factory.ts`
**Exports:** `createServer()`
**Changes:** None. Uses `SERVER.NAME` and `SERVER.VERSION` which are updated in Section 3.

### 2.9 `server/lifecycle.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/server/lifecycle.ts`
**Exports:** `initializeLifecycle()`, `setHttpServer()`, `shutdown()`, `registerShutdownHandlers()`
**Changes:** None. Graceful shutdown and signal handling are generic.

### 2.10 `session/session-manager.ts` — COPY VERBATIM

**Source:** `mcp-curl/src/lib/session/session-manager.ts`
**Exports:** `SessionManager` class
**Changes:** None. HTTP session management with idle timeout cleanup is generic.

### 2.11 `utils/error.ts` — COPY, THEN EXTEND

**Source:** `mcp-curl/src/lib/utils/error.ts`
**Exports:** `getErrorMessage()`, `createValidationError()`, `createAccessError()`, `createFileError()`, `createConfigError()`
**Changes:** Copy all existing functions unchanged, then **append** two new factory functions:

```typescript
/**
 * Create a connection error with profile context.
 * Never includes hostname, port, or credentials in the message.
 */
export function createConnectionError(profileName: string, reason: string): Error {
    return new Error(`Connection error [${profileName}]: ${reason}`);
}

/**
 * Create a guardrail enforcement error.
 */
export function createGuardrailError(profileName: string, statementType: string, reason: string): Error {
    return new Error(`Guardrail violation [${profileName}] ${statementType}: ${reason}`);
}
```

---

## 3. Adapt Files with Domain Changes

These files have useful patterns but contain curl-specific references. For each file, the **exact changes** are specified.

### 3.1 `config/limits.ts` — ADAPT

**Source:** `mcp-curl/src/lib/config/limits.ts`

**Keep unchanged:**
- `BYTES_PER_MB`
- `LIMITS.MAX_RESPONSE_SIZE` (10MB — used for query result size cap)
- `LIMITS.DEFAULT_MAX_RESULT_SIZE` (500KB — preview limit)
- `LIMITS.MAX_TOTAL_RESPONSE_MEMORY` (100MB — global memory cap)
- `LIMITS.ERROR_PREVIEW_LENGTH` (200)
- `LIMITS.MAX_METADATA_TAIL_LENGTH` (200)
- `LIMITS.DEFAULT_TIMEOUT_MS` (30000 — used as default query timeout)
- `LIMITS.FILENAME_MAX_LENGTH` (50)
- `LIMITS.DEFAULT_HTTP_PORT` (3000)
- `parsePort()` function

**Remove:**
- `LIMITS.MAX_REDIRECTS` — curl-specific, no HTTP redirects in SQL

**Add these new constants to the `LIMITS` object:**

```typescript
/** Maximum SQL query string length in bytes */
MAX_QUERY_LENGTH: 1_000_000,

/** Default connection establishment timeout in ms */
DEFAULT_CONNECTION_TIMEOUT_MS: 10_000,

/** Maximum concurrent connections per profile */
MAX_CONCURRENT_PER_PROFILE: 5,

/** Default max rows before truncation warning */
DEFAULT_MAX_ROWS: 10_000,
```

### 3.2 `config/session.ts` — ADAPT

**Source:** `mcp-curl/src/lib/config/session.ts`

**Keep unchanged:**
- `SESSION` object (max sessions, idle timeout, cleanup interval — all generic)
- `RATE_LIMIT` object (60/min per host, 300/min per client — relabel "host" as "profile" in comments only)

**Change:**
- `TEMP_DIR.PREFIX`: `"mcp-curl-"` → `"mcp-sql-"`

That is the only code change. Update any comments that reference "curl" or "HTTP requests" to say "SQL queries".

### 3.3 `config/server.ts` — ADAPT

**Source:** `mcp-curl/src/lib/config/server.ts`

**Change:**
- `SERVER.NAME`: `"curl-mcp-server"` → `"sql-mcp-server"`
- Keep `SERVER.VERSION` injection mechanism unchanged (`declare const __PACKAGE_VERSION__: string`)

### 3.4 `config/environment.ts` — REWRITE

**Source:** `mcp-curl/src/lib/config/environment.ts`

Replace the entire `ENV` constant. The pattern (frozen string constant object) stays; the values change:

```typescript
/**
 * Environment variable names for mcp-sql configuration.
 * Three-tier resolution: programmatic config > env var > built-in default.
 */
export const ENV = Object.freeze({
    /** Path to YAML profiles configuration file */
    CONFIG: "MCP_SQL_CONFIG",

    /** Directory for saving large query result files */
    OUTPUT_DIR: "MCP_SQL_OUTPUT_DIR",

    /** Bearer token for HTTP transport authentication */
    AUTH_TOKEN: "MCP_AUTH_TOKEN",

    /** Comma-separated allowed origins for HTTP transport CORS */
    ALLOWED_ORIGINS: "MCP_SQL_ALLOWED_ORIGINS",

    /** Host to bind HTTP transport to */
    HOST: "MCP_SQL_HOST",

    /** Port for HTTP transport */
    PORT: "PORT",
} as const);
```

**Removed from mcp-curl:** `ALLOW_LOCALHOST`, `USER_AGENT`, `REFERER` — not applicable to SQL.

### 3.5 `types/common.ts` — ADAPT

**Source:** `mcp-curl/src/lib/types/common.ts`

**Change:** The metadata separator string prefix:
- `"MCP-CURL"` → `"MCP-SQL"`

The `generateMetadataSeparator()` function and its UUID-based injection prevention logic stay identical.

### 3.6 `security/rate-limiter.ts` — ADAPT

**Source:** `mcp-curl/src/lib/security/rate-limiter.ts`

The rate limiter logic is generic (fixed time window, per-key tracking). The changes are semantic — "hostname" becomes "profile":

**Rename in code:**
- `hostRateLimitMap` → `profileRateLimitMap`
- Function signature: `checkRateLimits(hostname: string, clientId: string)` → `checkRateLimits(profileName: string, clientId: string)`
- Error message: `"Rate limit exceeded for host \"${hostname}\""` → `"Rate limit exceeded for profile \"${profileName}\""`
- Comments: update "per-host" references to "per-profile"

**Keep unchanged:**
- `clientRateLimitMap` and per-client logic
- `startRateLimitCleanup()`, `stopRateLimitCleanup()`, `clearRateLimitMaps()`
- All rate limit constants from `RATE_LIMIT` config
- The window/cleanup algorithm

### 3.7 `response/file-saver.ts` — ADAPT

**Source:** `mcp-curl/src/lib/response/file-saver.ts`

**Keep unchanged:**
- `createSafeFilenameBase()` — generic safe filename generation from arbitrary input

**Change:**
- `saveResponseToFile()` → rename to `saveResultToFile()`
- The first parameter semantics change: instead of receiving a URL to derive the filename from, it receives a `profileName` string
- File extension: `.txt` → `.json` (SQL results are always JSON)
- Update the filename pattern: `"{safeName}_{timestamp}.json"` where `safeName` is derived from `profileName`

**Concrete changes to `saveResultToFile`:**

```typescript
/**
 * Save query result to a file. Returns the full file path.
 *
 * @param content - The JSON string content to save
 * @param profileName - Profile name used for filename generation
 * @param outputDir - Optional output directory override
 */
export async function saveResultToFile(
    content: string,
    profileName: string,
    outputDir?: string,
): Promise<string> {
    const dir = outputDir
        ? await validateOutputDir(outputDir)
        : await getOrCreateTempDir();

    const safeName = createSafeFilenameBase(profileName, "query");
    const filename = `${safeName}_${Date.now()}.json`;
    const filepath = path.join(dir, filename);

    await fs.writeFile(filepath, content, "utf-8");
    return filepath;
}
```

### 3.8 `transports/http.ts` — ADAPT

**Source:** `mcp-curl/src/lib/transports/http.ts`

This is a large file. Most of it is generic middleware (origin validation, bearer auth, session management, Express+SSE setup).

**Changes:**
- All console messages: `"cURL MCP server"` → `"SQL MCP server"`
- Add `profiles` to the options/context passed through to `registerAllCapabilities()`:

Find the call to `registerAllCapabilities(server)` and change to:
```typescript
registerAllCapabilities(server, options.profiles)
```

Where `options.profiles` is a new optional field on the HTTP app options interface:
```typescript
profiles?: ReadonlyMap<string, ConnectionProfile> | null
```

**Keep everything else unchanged** — origin validation middleware, auth middleware, session lifecycle, SSE transport setup, error handling.

### 3.9 `transports/stdio.ts` — ADAPT

**Source:** `mcp-curl/src/lib/transports/stdio.ts`

**Changes:**
- Add `configPath` parameter for profile loading
- Update the console message
- Thread profiles to `registerAllCapabilities()`

**Target implementation:**

```typescript
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cleanupOrphanedTempDirs } from "../files/temp-manager.js";
import { startRateLimitCleanup, stopRateLimitCleanup } from "../security/rate-limiter.js";
import { initializeLifecycle } from "../server/lifecycle.js";
import { createServer } from "../server/server-factory.js";
import { registerAllCapabilities } from "../server/registration.js";
import { ENV } from "../config/environment.js";
import { loadProfiles } from "../profiles/loader.js";
import type { ConnectionProfile } from "../types/profile.js";

export async function runStdio(configPath?: string): Promise<void> {
    await cleanupOrphanedTempDirs();
    const rateLimitInterval = startRateLimitCleanup();
    initializeLifecycle(null, rateLimitInterval);

    try {
        // Load profiles if config path provided (CLI arg or env var)
        const resolvedPath = configPath || process.env[ENV.CONFIG];
        let profiles: ReadonlyMap<string, ConnectionProfile> | null = null;
        if (resolvedPath) {
            profiles = await loadProfiles(resolvedPath);
        }

        const server = createServer();
        registerAllCapabilities(server, profiles);
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("SQL MCP server running on stdio");
    } catch (error) {
        stopRateLimitCleanup(rateLimitInterval);
        throw error;
    }
}
```

---

## 4. Create New SQL-Specific Files

These files have no mcp-curl equivalent. Write from scratch.

### 4.1 `types/profile.ts` — NEW

Defines the connection profile types used throughout the project.

```typescript
/**
 * Supported database driver types.
 */
export type DriverType = "mysql" | "mariadb" | "postgres" | "mssql";

/**
 * SSL/TLS configuration for a database connection.
 */
export interface SSLConfig {
    readonly enabled?: boolean;
    readonly ca?: string;
    readonly cert?: string;
    readonly key?: string;
    readonly rejectUnauthorized?: boolean;
}

/**
 * Per-profile safety guardrails. All optional, all off by default.
 * The server is a proxy — DB-level permissions are the primary defence.
 */
export interface Guardrails {
    readonly readonly?: boolean;
    readonly blocked_statements?: ReadonlySet<string>;
    readonly max_rows?: number;
    readonly max_execution_time?: number;
    readonly allowed_databases?: ReadonlySet<string>;
}

/**
 * A named database connection profile.
 * Credentials are resolved from env vars at load time — never stored as raw strings.
 */
export interface ConnectionProfile {
    readonly driver: DriverType;
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database?: string;
    readonly ssl?: SSLConfig;
    readonly connection_timeout?: number;
    readonly query_timeout?: number;
    readonly guardrails?: Guardrails;
    readonly max_concurrent?: number;
}
```

### 4.2 `types/query-result.ts` — NEW

Defines the structured query result types.

```typescript
/**
 * Column metadata from a query result.
 */
export interface ColumnInfo {
    readonly name: string;
    readonly type: string;
}

/**
 * Table metadata from schema discovery.
 */
export interface TableInfo {
    readonly name: string;
    readonly type: "TABLE" | "VIEW";
    readonly schema?: string;
}

/**
 * Structured query result returned by drivers.
 */
export interface QueryResult {
    readonly columns: readonly ColumnInfo[];
    readonly rows: readonly unknown[][];
    readonly row_count: number;
    readonly affected_rows: number;
    readonly query_time_ms: number;
    readonly truncated: boolean;
    readonly saved_to_file: string | null;
}
```

### 4.3 `types/public.ts` — NEW (replaces mcp-curl's public.ts entirely)

Defines the public API types for `McpSqlServer`.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * McpSqlServer configuration.
 * Three-tier resolution: programmatic > env var > built-in default.
 */
export interface McpSqlConfig {
    /** Path to YAML profiles configuration file */
    configPath?: string;

    /** Default profile name when not specified in tool calls */
    defaultProfile?: string;

    /** Directory for saving large query result files */
    outputDir?: string;

    /** Max inline result size in bytes before auto-saving to file (default: 500KB) */
    maxResultSize?: number;

    /** Port for HTTP transport */
    port?: number;

    /** Host for HTTP transport */
    host?: string;

    /** Bearer token for HTTP transport authentication */
    authToken?: string;

    /** Allowed origins for HTTP transport CORS */
    allowedOrigins?: readonly string[];
}

/** Transport mode selection */
export type TransportMode = "stdio" | "http";

/**
 * Hook context passed to all hook functions.
 * The tool name identifies which MCP tool is being invoked.
 */
export interface HookContext<T> {
    readonly tool: "sql_execute" | "query_file" | "list_databases" | "list_tables" | "describe_table";
    params: T;
    readonly sessionId?: string;
    readonly config: Readonly<McpSqlConfig>;
}

/** Return type for beforeQuery hooks — null continues, object short-circuits */
export type BeforeQueryResult = {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
} | null;

/** Hook called before query execution. Can modify params or short-circuit. */
export type BeforeQueryHook = (context: HookContext<unknown>) => Promise<BeforeQueryResult> | BeforeQueryResult;

/** Hook called after successful query execution. For logging/metrics. */
export type AfterQueryHook = (context: HookContext<unknown>, result: unknown) => Promise<void> | void;

/** Hook called on error. Can suppress the error by returning true. */
export type OnErrorHook = (context: HookContext<unknown>, error: Error) => Promise<boolean> | boolean;

/**
 * Custom tool metadata for registration via McpSqlServer.registerCustomTool().
 */
export interface CustomToolMeta {
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
```

### 4.4 `config/security/guardrails.ts` — NEW

Frozen statement classification data and pure predicate functions.

```typescript
/**
 * Statement types allowed in read-only mode.
 * Pure data — no side effects, safe to freeze.
 */
export const READONLY_ALLOWED: ReadonlySet<string> = Object.freeze(
    new Set(["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "USE"]),
);

/**
 * Database-specific dangerous commands blocked by default across ALL profiles.
 * These allow file system access or OS command execution.
 */
export const DEFAULT_BLOCKED_COMMANDS: ReadonlySet<string> = Object.freeze(
    new Set([
        // MySQL/MariaDB
        "LOAD",           // LOAD DATA INFILE — reads server filesystem
        // PostgreSQL
        "COPY",           // COPY FROM/TO — reads/writes server filesystem
        // MSSQL
        "xp_cmdshell",    // OS command execution
        "EXEC",           // Can invoke xp_cmdshell, sp_OACreate, etc.
        "EXECUTE",        // Alias for EXEC
        "RECONFIGURE",    // Server config changes
    ]),
);

/**
 * Check if a statement type is allowed in read-only mode.
 */
export function isReadOnlyAllowed(statementType: string): boolean {
    return READONLY_ALLOWED.has(statementType.toUpperCase());
}

/**
 * Check if a statement type is blocked by default (dangerous DB commands).
 */
export function isDefaultBlocked(statementType: string): boolean {
    return DEFAULT_BLOCKED_COMMANDS.has(statementType);
}

/**
 * Check if a statement type is in a custom blocklist.
 */
export function isBlockedStatement(
    statementType: string,
    blocklist: ReadonlySet<string>,
): boolean {
    return blocklist.has(statementType.toUpperCase());
}
```

### 4.5 `profiles/validator.ts` — NEW

Zod schema for YAML profile validation.

```typescript
import { z } from "zod";
import type { ConnectionProfile, Guardrails, DriverType } from "../types/profile.js";

/**
 * Profile name pattern: lowercase alphanumeric with hyphens/underscores.
 * Must start with a letter. Max 64 characters.
 */
const PROFILE_NAME_REGEX = /^[a-z][a-z0-9_-]{0,63}$/;

const SSLSchema = z.object({
    enabled: z.boolean().optional(),
    ca: z.string().optional(),
    cert: z.string().optional(),
    key: z.string().optional(),
    rejectUnauthorized: z.boolean().optional(),
}).strict().optional();

const GuardrailsSchema = z.object({
    readonly: z.boolean().optional(),
    blocked_statements: z.array(z.string().toUpperCase()).optional(),
    max_rows: z.number().int().positive().optional(),
    max_execution_time: z.number().positive().optional(),
    allowed_databases: z.array(z.string()).optional(),
}).strict().optional();

const ProfileSchema = z.object({
    driver: z.enum(["mysql", "mariadb", "postgres", "mssql"]),
    host: z.string().min(1, "Host is required"),
    port: z.number().int().positive().optional(),
    user: z.string().min(1, "User is required"),
    password: z.string().min(1, "Password is required"),
    database: z.string().optional(),
    ssl: SSLSchema,
    connection_timeout: z.number().positive().optional(),
    query_timeout: z.number().positive().optional(),
    guardrails: GuardrailsSchema,
    max_concurrent: z.number().int().positive().optional(),
}).strict();

export const ProfilesConfigSchema = z.record(
    z.string().regex(PROFILE_NAME_REGEX, "Profile name must be lowercase alphanumeric with hyphens/underscores, starting with a letter"),
    ProfileSchema,
);

/**
 * Default ports per driver type.
 */
const DEFAULT_PORTS: Record<string, number> = {
    mysql: 3306,
    mariadb: 3306,
    postgres: 5432,
    mssql: 1433,
};

/**
 * Validate raw parsed YAML data into a frozen Map of ConnectionProfiles.
 *
 * @throws Error if validation fails (with Zod error details)
 */
export function validateProfiles(data: unknown): ReadonlyMap<string, ConnectionProfile> {
    const parsed = ProfilesConfigSchema.parse(data);
    const profiles = new Map<string, ConnectionProfile>();

    for (const [name, raw] of Object.entries(parsed)) {
        const guardrails: Guardrails | undefined = raw.guardrails
            ? Object.freeze({
                readonly: raw.guardrails.readonly,
                blocked_statements: raw.guardrails.blocked_statements
                    ? Object.freeze(new Set(raw.guardrails.blocked_statements))
                    : undefined,
                max_rows: raw.guardrails.max_rows,
                max_execution_time: raw.guardrails.max_execution_time,
                allowed_databases: raw.guardrails.allowed_databases
                    ? Object.freeze(new Set(raw.guardrails.allowed_databases))
                    : undefined,
            })
            : undefined;

        const profile: ConnectionProfile = Object.freeze({
            driver: raw.driver as DriverType,
            host: raw.host,
            port: raw.port ?? DEFAULT_PORTS[raw.driver] ?? 3306,
            user: raw.user,
            password: raw.password,
            database: raw.database,
            ssl: raw.ssl ? Object.freeze(raw.ssl) : undefined,
            connection_timeout: raw.connection_timeout,
            query_timeout: raw.query_timeout,
            guardrails,
            max_concurrent: raw.max_concurrent,
        });

        profiles.set(name, profile);
    }

    return profiles;
}
```

### 4.6 `profiles/loader.ts` — NEW

YAML file loading with `${ENV_VAR}` interpolation.

```typescript
import * as fs from "node:fs/promises";
import * as yaml from "js-yaml";
import { validateProfiles } from "./validator.js";
import { createConfigError } from "../utils/error.js";
import type { ConnectionProfile } from "../types/profile.js";

/**
 * Pattern matching ${ENV_VAR} or ${ENV_VAR:-default} in string values.
 */
const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;

/**
 * Interpolate ${ENV_VAR} references in string values.
 * Supports optional defaults: ${VAR:-fallback}
 *
 * @throws Error if a referenced env var is undefined and has no default
 */
function interpolateEnvVars(value: string): string {
    return value.replace(ENV_VAR_PATTERN, (match, varName, defaultValue) => {
        const envValue = process.env[varName];
        if (envValue !== undefined) return envValue;
        if (defaultValue !== undefined) return defaultValue;
        throw createConfigError(varName, "undefined", `Environment variable \${${varName}} is not set and has no default`);
    });
}

/**
 * Deep-walk an object and interpolate env vars in all string values.
 */
function interpolateObject(obj: unknown): unknown {
    if (typeof obj === "string") {
        return interpolateEnvVars(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(interpolateObject);
    }
    if (obj !== null && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = interpolateObject(value);
        }
        return result;
    }
    return obj;
}

/**
 * Load and validate a YAML profiles configuration file.
 *
 * 1. Read file from disk
 * 2. Parse YAML with safe schema (no code execution)
 * 3. Interpolate ${ENV_VAR} references in all string values
 * 4. Validate with Zod schema
 * 5. Return frozen Map<string, ConnectionProfile>
 *
 * @throws Error if file not found, YAML invalid, env var missing, or validation fails
 */
export async function loadProfiles(configPath: string): Promise<ReadonlyMap<string, ConnectionProfile>> {
    // 1. Read file
    let content: string;
    try {
        content = await fs.readFile(configPath, "utf-8");
    } catch (error) {
        throw createConfigError("configPath", configPath, `Cannot read profiles file: ${(error as Error).message}`);
    }

    // 2. Parse YAML with safe schema (JSON_SCHEMA prevents !!js/function etc.)
    let parsed: unknown;
    try {
        parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (error) {
        throw createConfigError("configPath", configPath, `Invalid YAML: ${(error as Error).message}`);
    }

    if (parsed === null || parsed === undefined || typeof parsed !== "object") {
        throw createConfigError("configPath", configPath, "Profiles file must contain a YAML object");
    }

    // 3. Interpolate env vars
    const interpolated = interpolateObject(parsed);

    // 4-5. Validate and return frozen profiles
    return validateProfiles(interpolated);
}
```

### 4.7 `config/defaults.ts` — NEW

Three-tier config resolution utility.

```typescript
/**
 * Three-tier config resolution: programmatic value > environment variable > built-in default.
 */
export function resolveDefault<T>(
    configValue: T | undefined,
    envVarName: string | undefined,
    builtInDefault: T,
): T {
    if (configValue !== undefined) return configValue;
    if (envVarName) {
        const envValue = process.env[envVarName];
        if (envValue !== undefined) return envValue as unknown as T;
    }
    return builtInDefault;
}
```

### 4.8 `server/registration.ts` — NEW (replaces mcp-curl's)

Orchestration function. In Phase 1 this is a stub — tools are wired in Phase 6.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectionProfile } from "../types/profile.js";

/**
 * Register all MCP capabilities on a server instance.
 * Tools, resources, and prompts are registered here.
 *
 * In Phase 1 this is a stub. Tools are wired in Phase 6.
 */
export function registerAllCapabilities(
    server: McpServer,
    profiles?: ReadonlyMap<string, ConnectionProfile> | null,
): void {
    // Phase 6: registerAllTools(server, profiles)
    // Phase 6: registerAllResources(server, profiles)
    // Phase 6: registerAllPrompts(server)

    // Log available profiles for debugging
    if (profiles && profiles.size > 0) {
        console.error(`Loaded ${profiles.size} profile(s): ${[...profiles.keys()].join(", ")}`);
    } else {
        console.error("No profiles loaded — tools will require explicit profile configuration");
    }
}
```

---

## 5. Create Entry Points

### 5.1 `src/index.ts` — CLI entry point

Adapt from mcp-curl. Add `--config` argument parsing:

```typescript
#!/usr/bin/env node
// src/index.ts
// CLI entry point — thin wrapper that selects transport and parses --config

import { registerShutdownHandlers } from "./lib/server/lifecycle.js";
import { runStdio } from "./lib/transports/stdio.js";
import { runHTTP } from "./lib/transports/http.js";

// Register shutdown handlers for graceful cleanup
registerShutdownHandlers();

// Parse --config argument
const configIndex = process.argv.indexOf("--config");
const configPath = configIndex !== -1 ? process.argv[configIndex + 1] : undefined;

// Select transport based on environment (case-insensitive)
const transport = (process.env.TRANSPORT || "stdio").toLowerCase();
if (transport === "http") {
    runHTTP(configPath).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
} else {
    runStdio(configPath).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
```

### 5.2 `src/lib.ts` — Library entry point

```typescript
// src/lib.ts
// Library entry point for programmatic usage of mcp-sql

// Public API types
export type {
    McpSqlConfig,
    TransportMode,
    HookContext,
    BeforeQueryResult,
    BeforeQueryHook,
    AfterQueryHook,
    OnErrorHook,
    CustomToolMeta,
} from "./lib/types/public.js";

// Profile types
export type {
    DriverType,
    ConnectionProfile,
    Guardrails,
    SSLConfig,
} from "./lib/types/profile.js";

// Query result types
export type {
    ColumnInfo,
    TableInfo,
    QueryResult,
} from "./lib/types/query-result.js";

// Profile loading
export { loadProfiles } from "./lib/profiles/loader.js";
export { validateProfiles } from "./lib/profiles/validator.js";
```

> **Note:** `McpSqlServer` class export is added here in Phase 5 when the extensible module is built.

### 5.3 `src/lib/index.ts` — Internal barrel export

```typescript
// src/lib/index.ts
// Internal barrel export — controls the public surface of src/lib/

// Config
export { LIMITS, BYTES_PER_MB, parsePort } from "./config/limits.js";
export { SESSION, RATE_LIMIT, TEMP_DIR } from "./config/session.js";
export { SERVER } from "./config/server.js";
export { ENV } from "./config/environment.js";

// Types
export type { RateLimitEntry } from "./types/rate-limit.js";
export type { Session } from "./types/session.js";
export type { ConnectionProfile, DriverType, Guardrails, SSLConfig } from "./types/profile.js";
export type { ColumnInfo, TableInfo, QueryResult } from "./types/query-result.js";
export type {
    McpSqlConfig,
    TransportMode,
    HookContext,
    BeforeQueryResult,
    BeforeQueryHook,
    AfterQueryHook,
    OnErrorHook,
    CustomToolMeta,
} from "./types/public.js";

// Profiles
export { loadProfiles } from "./profiles/loader.js";
export { validateProfiles } from "./profiles/validator.js";

// Security
export { checkRateLimits, startRateLimitCleanup, stopRateLimitCleanup } from "./security/rate-limiter.js";
export { safeStringCompare, isValidSessionId, validateNoCRLF } from "./security/input-validation.js";

// Files
export { getOrCreateTempDir, cleanupOrphanedTempDirs, cleanupTempDir } from "./files/temp-manager.js";
export { resolveOutputDir, validateOutputDir } from "./files/output-dir.js";

// Response
export { createSafeFilenameBase, saveResultToFile } from "./response/file-saver.js";

// Server
export { createServer } from "./server/server-factory.js";
export { registerShutdownHandlers, shutdown } from "./server/lifecycle.js";

// Session
export { SessionManager } from "./session/session-manager.js";

// Utils
export {
    getErrorMessage,
    createValidationError,
    createAccessError,
    createFileError,
    createConfigError,
    createConnectionError,
    createGuardrailError,
} from "./utils/error.js";
```

---

## 6. Create Barrel Exports

Each module directory needs an `index.ts` barrel file. These control the public surface and match mcp-curl's pattern.

Create these barrel files (each re-exports from its sibling source files):

| File | Re-exports from |
|------|-----------------|
| `config/index.ts` | `limits.ts`, `session.ts`, `server.ts`, `environment.ts`, `defaults.ts` |
| `config/security/index.ts` | `validation.ts`, `blocked-dirs.ts`, `guardrails.ts` |
| `types/index.ts` | `common.ts`, `rate-limit.ts`, `session.ts`, `profile.ts`, `query-result.ts`, `public.ts` |
| `security/index.ts` | `rate-limiter.ts`, `input-validation.ts` |
| `files/index.ts` | `temp-manager.ts`, `output-dir.ts` |
| `response/index.ts` | `file-saver.ts` |
| `server/index.ts` | `server-factory.ts`, `lifecycle.ts`, `registration.ts` |
| `session/index.ts` | `session-manager.ts` |
| `transports/index.ts` | `stdio.ts`, `http.ts` |
| `profiles/index.ts` | `loader.ts`, `validator.ts` |
| `utils/index.ts` | `error.ts` |

Create empty barrel stubs for directories that will be populated in later phases:

| File | Contents |
|------|----------|
| `tools/index.ts` | `// Phase 6: tool handlers` |
| `resources/index.ts` | `// Phase 6: MCP resources` |
| `prompts/index.ts` | `// Phase 6: MCP prompts` |
| `extensible/index.ts` | `// Phase 5: McpSqlServer builder` |

---

## 7. Testing

### 7.1 Test files to create (co-located with source)

| Test file | What to test |
|-----------|-------------|
| `config/limits.test.ts` | `LIMITS` object is frozen, all values are positive, `parsePort()` works |
| `config/session.test.ts` | `SESSION`, `RATE_LIMIT`, `TEMP_DIR` are frozen with correct values |
| `config/environment.test.ts` | `ENV` object is frozen, all values are non-empty strings |
| `config/security/guardrails.test.ts` | `READONLY_ALLOWED` and `DEFAULT_BLOCKED_COMMANDS` are frozen; predicate functions return correct results for known statement types |
| `types/common.test.ts` | `generateMetadataSeparator()` returns unique values, contains "MCP-SQL" |
| `profiles/validator.test.ts` | Valid profiles parse correctly; invalid profiles rejected (bad driver, missing host, invalid profile name, unknown fields via strict mode); guardrails converted to Sets; default ports applied per driver |
| `profiles/loader.test.ts` | YAML loads and interpolates `${ENV_VAR}`; missing env var throws; `${VAR:-default}` syntax works; `!!js/function` rejected by safe schema; empty file throws; non-object YAML throws |
| `security/rate-limiter.test.ts` | Per-profile and per-client rate limits enforced; window expiry resets counts; cleanup removes expired entries |
| `utils/error.test.ts` | All error factory functions produce correctly formatted messages including new `createConnectionError()` and `createGuardrailError()` |

### 7.2 Test patterns from mcp-curl to follow

- Use `describe()` / `it()` blocks (vitest globals)
- Use `beforeEach()` to reset state (e.g., `clearRateLimitMaps()`)
- Use `vi.stubEnv()` for environment variable tests
- Test frozen objects with `Object.isFrozen()`
- Co-locate test files: `validator.test.ts` next to `validator.ts`

---

## 8. Verification Checklist

When Phase 1 is complete, verify:

- [ ] `npm install` succeeds with no errors
- [ ] `npm run build` compiles cleanly with no TypeScript errors
- [ ] `npm test` passes all tests
- [ ] No references to "curl" remain in source code (except possibly in comments noting the pattern origin)
- [ ] Profile YAML loads, validates, and returns a frozen `ReadonlyMap`
- [ ] Environment variable interpolation works: `${VAR}` and `${VAR:-default}`
- [ ] Missing required env vars throw on startup (fail-fast)
- [ ] Zod schema rejects invalid profiles with helpful error messages
- [ ] All config objects are frozen (`Object.isFrozen()`)
- [ ] All error factories produce correctly formatted messages
- [ ] `npm start` runs (prints "SQL MCP server running on stdio" then waits)
- [ ] Rate limiter tracks per-profile and per-client windows correctly
- [ ] Directory structure matches the module map from the plan

### Quick smoke test

```bash
# Build and verify CLI starts
npm run build
echo '{}' | timeout 2 node dist/index.js 2>&1 || true
# Should print: "SQL MCP server running on stdio"

# Verify with a profiles file
cat > /tmp/test-profiles.yaml << 'EOF'
test-db:
  driver: mysql
  host: localhost
  port: 3306
  user: testuser
  password: testpass
EOF

echo '{}' | timeout 2 node dist/index.js --config /tmp/test-profiles.yaml 2>&1 || true
# Should print: "Loaded 1 profile(s): test-db"
# Then: "SQL MCP server running on stdio"
```

---

## File Summary

| Category | Count | Files |
|----------|-------|-------|
| Copy verbatim | 11 | validation.ts, blocked-dirs.ts, rate-limit.ts, session (type), input-validation.ts, temp-manager.ts, output-dir.ts, server-factory.ts, lifecycle.ts, session-manager.ts, error.ts (+2 additions) |
| Adapt | 9 | limits.ts, session (config), server.ts, environment.ts, common.ts, rate-limiter.ts, file-saver.ts, http.ts, stdio.ts |
| New SQL-specific | 8 | profile.ts, query-result.ts, public.ts, guardrails.ts, validator.ts, loader.ts, defaults.ts, registration.ts |
| Entry points | 3 | index.ts, lib.ts, lib/index.ts |
| Barrel exports | 15 | One per module directory |
| Config files | 5 | package.json, tsconfig.json, vitest.config.ts, tsup.config.ts, .gitignore |
| Test files | 9 | One per key module |
| **Total** | **~60** | |
