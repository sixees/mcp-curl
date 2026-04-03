---
title: "feat: MCP SQL Proxy Server"
type: feat
status: active
date: 2026-03-12
brainstorm: docs/brainstorms/2026-03-12-mcp-sql-proxy-brainstorm.md
---

# feat: MCP SQL Proxy Server

## Overview

A new MCP server (`mcp-sql`) that proxies SQL queries from AI clients to relational databases (MySQL, MariaDB, PostgreSQL, Microsoft SQL Server). The server receives SQL from an AI agent, forwards it to a configured database via a named connection profile, and returns structured JSON results. Schema discovery tools abstract cross-database dialect differences for database-agnostic AI exploration.

This is a **new project** — not a fork of mcp-curl — but carries forward its proven architectural patterns: builder with frozen config, hook system, transport abstraction, layered security, three-tier config resolution, and co-located tests.

**Primary use case:** AI agents interactively exploring and querying databases during conversations.

## Problem Statement

AI agents need database access for data exploration, analysis, and schema understanding. Current options require the AI to know database-specific SQL dialects, manage credentials directly, or use heavy ORMs that obscure the actual queries. There is no lightweight MCP server that:

1. Proxies SQL transparently without rewriting it
2. Abstracts cross-database dialect differences for schema discovery
3. Keeps credentials out of the AI conversation via named profiles
4. Provides configurable guardrails as a safety net (not a primary security mechanism)
5. Handles large result sets gracefully within context window limits

## Proposed Solution

A TypeScript MCP server with these core tools:

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `sql_execute` | Execute SQL against a named profile | Both |
| `query_file` | Page through auto-saved large result files | Read |
| `list_databases` | List databases visible to a profile | Read |
| `list_tables` | List tables in a database | Read |
| `describe_table` | Column definitions, types, keys | Read |

Connection profiles are defined in YAML with `${ENV_VAR}` interpolation for secrets. Each query opens a fresh connection (connect-per-query). Optional per-profile guardrails provide a safety net on top of database-level permissions.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AI Client                         │
└──────────────┬──────────────────────────┬────────────┘
               │ stdio                    │ HTTP/SSE
┌──────────────▼──────────────────────────▼────────────┐
│              Transport Layer                          │
│         (stdio / HTTP+Express+SSE)                   │
├──────────────────────────────────────────────────────┤
│              MCP Server (SDK)                         │
│         Tool registration, schema, lifecycle         │
├──────────────────────────────────────────────────────┤
│              McpSqlServer (Builder)                   │
│    .configure() .beforeQuery() .afterQuery() .start()│
├──────────────────────────────────────────────────────┤
│              Hook System                             │
│    beforeQuery → execute → afterQuery → onError      │
├────────────────┬─────────────────────────────────────┤
│  Guardrails    │         Tool Handlers               │
│  (statement    │  sql_execute, query_file,            │
│   classifier,  │  list_databases, list_tables,        │
│   rate limit)  │  describe_table                      │
├────────────────┴─────────────┬───────────────────────┤
│          Execution Layer     │   Response Processor   │
│  Driver selection, connect,  │  Format, size check,   │
│  execute, disconnect,        │  auto-save, truncate   │
│  memory tracking, semaphore  │                        │
├──────────────────────────────┴───────────────────────┤
│              Database Drivers                         │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│    │  MySQL/  │  │ Postgres │  │  MSSQL   │         │
│    │ MariaDB  │  │   (pg)   │  │ (mssql)  │         │
│    │ (mysql2) │  │          │  │          │         │
│    └──────────┘  └──────────┘  └──────────┘         │
└──────────────────────────────────────────────────────┘
```

### Module Map

```
mcp-sql/
├── src/
│   ├── index.ts                    # CLI entry point (transport selection)
│   ├── lib.ts                      # Library entry point (McpSqlServer, types, schema)
│   └── lib/
│       ├── config/                 # Constants, limits, env vars, server identity
│       │   ├── limits.ts           # MAX_RESULT_SIZE, MAX_QUERY_LENGTH, timeouts, etc.
│       │   ├── environment.ts      # ENV const: MCP_SQL_CONFIG, MCP_SQL_OUTPUT_DIR, etc.
│       │   ├── server.ts           # SERVER.NAME, SERVER.VERSION (build-time injection)
│       │   ├── session.ts          # Session, rate limit, temp dir constants
│       │   ├── defaults.ts         # resolveDefault() — 3-tier config resolution
│       │   ├── security/
│       │   │   ├── guardrails.ts   # Frozen statement blocklists, pure predicates
│       │   │   └── blocked-dirs.ts # System directory blocklist for file output
│       │   └── index.ts
│       ├── types/
│       │   ├── public.ts           # McpSqlConfig, hook types, TransportMode
│       │   ├── query-result.ts     # QueryResult, ColumnInfo, TableInfo
│       │   ├── profile.ts          # ConnectionProfile, Guardrails, SSLConfig
│       │   ├── session.ts          # HTTP session types
│       │   ├── rate-limit.ts       # Rate limit entry type
│       │   └── index.ts
│       ├── security/
│       │   ├── statement-classifier.ts  # Classify SQL statement type (SELECT/INSERT/DROP/etc.)
│       │   ├── guardrail-enforcer.ts    # Enforce profile guardrails against classified statement
│       │   ├── error-sanitizer.ts       # Strip hostnames, IPs, SQL from driver error messages
│       │   ├── rate-limiter.ts          # Per-profile + per-client rate limiting
│       │   ├── input-validation.ts      # Session ID validation, timing-safe compare
│       │   └── index.ts
│       ├── drivers/
│       │   ├── types.ts                 # DatabaseDriver interface, Connection type
│       │   ├── mysql-driver.ts          # MySQL/MariaDB implementation (mysql2)
│       │   ├── postgres-driver.ts       # PostgreSQL implementation (pg)
│       │   ├── mssql-driver.ts          # MSSQL implementation (mssql)
│       │   ├── driver-registry.ts       # Map<driverName, DriverFactory>
│       │   └── index.ts
│       ├── execution/
│       │   ├── query-executor.ts        # Connect → execute → disconnect (with finally)
│       │   ├── memory-tracker.ts        # Global memory allocator (100MB cap)
│       │   ├── concurrency-limiter.ts   # Per-profile semaphore (default: 5)
│       │   └── index.ts
│       ├── files/
│       │   ├── temp-manager.ts          # Lazy singleton, orphan cleanup
│       │   ├── output-dir.ts            # Output dir validation (realpath, blocked dirs)
│       │   └── index.ts
│       ├── response/
│       │   ├── formatter.ts             # Format QueryResult → JSON string
│       │   ├── file-saver.ts            # Safe filename, permissions, realpath verify
│       │   ├── processor.ts             # Size check → auto-save → truncate pipeline
│       │   └── index.ts
│       ├── server/
│       │   ├── server-factory.ts        # createServer() → new McpServer(...)
│       │   ├── schemas.ts               # Zod schemas: SqlExecuteSchema, QueryFileSchema, etc.
│       │   ├── registration.ts          # registerAllCapabilities() orchestration
│       │   ├── lifecycle.ts             # Signal handlers, graceful shutdown
│       │   └── index.ts
│       ├── session/
│       │   ├── session-manager.ts       # Map + cleanup interval + max sessions
│       │   └── index.ts
│       ├── tools/
│       │   ├── sql-execute.ts           # sql_execute tool handler
│       │   ├── query-file.ts            # query_file tool handler
│       │   ├── list-databases.ts        # list_databases tool handler
│       │   ├── list-tables.ts           # list_tables tool handler
│       │   ├── describe-table.ts        # describe_table tool handler
│       │   └── index.ts
│       ├── resources/
│       │   └── profile-docs.ts          # MCP resource: profile documentation
│       ├── prompts/
│       │   ├── data-exploration.ts      # MCP prompt: data exploration guide
│       │   └── schema-discovery.ts      # MCP prompt: schema discovery guide
│       ├── transports/
│       │   ├── stdio.ts                 # Stdio transport
│       │   ├── http.ts                  # HTTP + Express + SSE transport
│       │   └── index.ts
│       ├── profiles/
│       │   ├── types.ts                 # YAML profile schema types
│       │   ├── validator.ts             # Zod schema for profile YAML
│       │   ├── loader.ts               # YAML load + env var interpolation + validation
│       │   └── index.ts
│       ├── extensible/
│       │   ├── mcp-sql-server.ts        # McpSqlServer builder class
│       │   ├── hook-executor.ts         # executeWithHooks() — generic hook pipeline
│       │   ├── tool-wrapper.ts          # Config transforms + hook wrapping for tools
│       │   ├── instance-utilities.ts    # .utilities() for direct query execution
│       │   ├── types.ts                 # ToolResult, Hooks, ToolExtra, ToolName
│       │   └── index.ts
│       └── utils/
│           ├── error.ts                 # Error factory functions
│           └── index.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── CLAUDE.md
└── README.md
```

### Implementation Phases

#### Phase 1: Foundation (Scaffold + Config + Profiles)

**Goal:** Project setup, build pipeline, config system, YAML profile loading. No database connectivity yet.

**Tasks:**

- [ ] **Project scaffold** — Initialize npm project, TypeScript, tsup, vitest, ESLint
  - `package.json` with subpath exports: `.` (lib), `./cli` (CLI), `./drivers` (driver interface)
  - `tsup.config.ts` with multi-entry, splitting, version injection
  - `tsconfig.json` — ES2022, NodeNext, strict
  - `vitest.config.ts` — co-located test pattern

- [ ] **Config layer** — `src/lib/config/`
  - `limits.ts` — MAX_RESULT_SIZE (10MB), MAX_INLINE_SIZE (500KB), MAX_QUERY_LENGTH (1MB), DEFAULT_CONNECTION_TIMEOUT (10s), DEFAULT_QUERY_TIMEOUT (30s), MAX_TOTAL_MEMORY (100MB), MAX_CONCURRENT_PER_PROFILE (5), FILENAME_MAX_LENGTH (50)
  - `environment.ts` — ENV const: `MCP_SQL_CONFIG`, `MCP_SQL_OUTPUT_DIR`, `MCP_SQL_ALLOW_MULTI_STATEMENT`, `MCP_AUTH_TOKEN`, `MCP_SQL_MAX_RESULT_SIZE`
  - `server.ts` — SERVER.NAME (`sql-mcp-server`), SERVER.VERSION (build-time injection)
  - `session.ts` — Session limits, rate limit windows, temp dir prefix (`mcp-sql-`)
  - `defaults.ts` — `resolveDefault(configValue, envVarName, builtInDefault)` — 3-tier resolution

- [ ] **Config security predicates** — `src/lib/config/security/`
  - `guardrails.ts` — Frozen statement classification data:
    - `READONLY_ALLOWED`: frozen `Set<string>` — `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `WITH` (read CTEs)
    - `DEFAULT_BLOCKED`: frozen `Set<string>` — `LOAD`, `COPY`, `xp_cmdshell`, `EXEC` (dangerous DB-specific)
    - Pure predicates: `isReadOnlyStatement(type)`, `isDefaultBlocked(type)`, `isBlockedStatement(type, blocklist)`
  - `blocked-dirs.ts` — reuse pattern from mcp-curl

- [ ] **Types** — `src/lib/types/`
  - `public.ts` — `McpSqlConfig` interface (port, host, authToken, allowedOrigins, outputDir, maxResultSize, configPath, defaultProfile), hook types parameterized via `<T>`, `TransportMode`
  - `profile.ts` — `ConnectionProfile`, `Guardrails`, `SSLConfig`, `DriverType` enum
  - `query-result.ts` — `QueryResult`, `ColumnInfo`, `TableInfo`, `ProcessedResult`
  - Compile-time exhaustive config key check (`_AssertExhaustive` pattern)

- [ ] **Error utilities** — `src/lib/utils/error.ts`
  - Carry forward: `getErrorMessage()`, `createValidationError()`, `createAccessError()`, `createFileError()`, `createConfigError()`
  - Add: `createConnectionError(profileName, reason)`, `createGuardrailError(profileName, statement, reason)`

- [ ] **YAML profile loader** — `src/lib/profiles/`
  - `types.ts` — YAML structure types (ProfilesConfig, ProfileDefinition)
  - `validator.ts` — Zod schema with:
    - Driver enum: `mysql`, `mariadb`, `postgres`, `mssql`
    - Required fields: `driver`, `host`, `user`, `password`
    - Optional: `port` (default per driver), `database`, `ssl`, `connection_timeout`, `query_timeout`, `guardrails`, `max_concurrent`
    - Profile name format: `/^[a-z][a-z0-9_-]*$/`, max 64 chars
    - Duplicate profile name detection
    - Guardrails sub-schema: `readonly`, `blocked_statements`, `max_rows`, `max_execution_time`, `allowed_databases`
  - `loader.ts` — `loadProfiles(path)`:
    1. Read file
    2. Parse YAML with `yaml.JSON_SCHEMA` (prevent code execution)
    3. Interpolate `${ENV_VAR}` references — **fail on startup** for undefined vars in required fields (password, host, user)
    4. Validate with Zod
    5. Return frozen `Map<string, ConnectionProfile>`
  - Log warning for profiles with no guardrails: `"Profile 'X' has no guardrails configured. All SQL statements are allowed."`

- [ ] **Tests for Phase 1:**
  - `config/*.test.ts` — constants frozen, predicates correct
  - `profiles/validator.test.ts` — valid/invalid YAML, env var interpolation, duplicate names, missing required fields
  - `profiles/loader.test.ts` — file loading, YAML safety (reject `!!js/function`), env var missing error
  - `utils/error.test.ts` — all factory functions

**Success criteria:** `npm run build` produces clean output. Profile YAML loads, validates, and freezes correctly. All config predicates pass tests.

---

#### Phase 2: Database Drivers + Execution

**Goal:** Database connectivity. Connect, execute SQL, return results. No MCP layer yet.

**Tasks:**

- [ ] **DatabaseDriver interface** — `src/lib/drivers/types.ts`
  ```typescript
  interface DatabaseDriver {
    readonly driverName: string;
    readonly defaultPort: number;
    connect(profile: ConnectionProfile): Promise<Connection>;
    execute(conn: Connection, sql: string, params?: unknown[]): Promise<RawQueryResult>;
    disconnect(conn: Connection): Promise<void>;
    listDatabases(conn: Connection): Promise<string[]>;
    listTables(conn: Connection, database?: string, pattern?: string): Promise<TableInfo[]>;
    describeTable(conn: Connection, table: string, database?: string): Promise<ColumnInfo[]>;
  }
  ```
  - `Connection` is an opaque type per driver (wraps the native connection object)
  - `RawQueryResult` contains: columns (name + native type string), rows (array of arrays), affected_rows, insert_id
  - `params` uses `?` as universal placeholder; driver translates to native syntax (`$1`, `@p1`)

- [ ] **MySQL/MariaDB driver** — `src/lib/drivers/mysql-driver.ts`
  - Uses `mysql2/promise` for async API
  - `connect()`: `mysql.createConnection({ host, port, user, password, database, connectTimeout, ssl })`
  - `execute()`: `conn.execute(sql, params)` — native `?` placeholders (no translation needed)
  - `listDatabases()`: `SHOW DATABASES` filtered by `allowed_databases`
  - `listTables()`: `SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'` + views
  - `describeTable()`: `SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
  - `disconnect()`: `conn.end()` in finally block
  - Query timeout: `SET max_execution_time = X` before query (MySQL 5.7.8+) or connection-level `timeout`

- [ ] **PostgreSQL driver** — `src/lib/drivers/postgres-driver.ts`
  - Uses `pg` (node-postgres) `Client` class
  - `connect()`: `new Client({ host, port, user, password, database, connectionTimeoutMillis, ssl })`
  - `execute()`: translate `?` → `$N` placeholders, `client.query(sql, params)`
  - `listDatabases()`: `SELECT datname FROM pg_database WHERE datistemplate = false`
  - `listTables()`: query `information_schema.tables` with `table_schema NOT IN ('pg_catalog', 'information_schema')`
  - `describeTable()`: query `information_schema.columns`
  - Query timeout: `SET statement_timeout = X` before query
  - `disconnect()`: `client.end()`

- [ ] **MSSQL driver** — `src/lib/drivers/mssql-driver.ts`
  - Uses `mssql` package with Tedious driver
  - `connect()`: `new mssql.ConnectionPool(config).connect()`
  - `execute()`: translate `?` → `@p1, @p2, ...`, use `request.input('p1', value).query(sql)`
  - `listDatabases()`: `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE'`
  - `listTables()`: query `INFORMATION_SCHEMA.TABLES`
  - `describeTable()`: query `INFORMATION_SCHEMA.COLUMNS`
  - Query timeout: `request.timeout = X`
  - `disconnect()`: `pool.close()`

- [ ] **Driver registry** — `src/lib/drivers/driver-registry.ts`
  - `getDriver(driverType: DriverType): DatabaseDriver`
  - Map: `mysql` → MySQLDriver, `mariadb` → MySQLDriver (same driver), `postgres` → PostgresDriver, `mssql` → MSSQLDriver
  - Lazy instantiation (create driver on first use)

- [ ] **Query executor** — `src/lib/execution/query-executor.ts`
  - `executeQuery(profile, sql, params?, options?)`:
    1. Get driver from registry
    2. Acquire semaphore slot (per-profile concurrency limiter)
    3. Allocate memory tracker budget
    4. `driver.connect(profile)` with connection timeout
    5. Set query timeout (SQL-level when possible, client-side fallback)
    6. `driver.execute(conn, sql, params)`
    7. Return `RawQueryResult`
    8. **Finally:** `driver.disconnect(conn)`, release semaphore, release memory

- [ ] **Memory tracker** — `src/lib/execution/memory-tracker.ts`
  - Carry forward from mcp-curl: `allocateMemory(bytes)`, `releaseMemory(bytes)`, `getCurrentMemoryUsage()`
  - 100MB global limit

- [ ] **Concurrency limiter** — `src/lib/execution/concurrency-limiter.ts`
  - Per-profile semaphore: `acquireSlot(profileName): Promise<ReleaseFunction>`
  - Default: 5 concurrent connections per profile
  - Configurable via `max_concurrent` in profile YAML
  - Queue with timeout: if slot not available within 30s, reject with error

- [ ] **Tests for Phase 2:**
  - `drivers/mysql-driver.test.ts` — placeholder translation, discovery SQL generation (unit tests with mocked connections)
  - `drivers/postgres-driver.test.ts` — `?` → `$N` translation, discovery queries
  - `drivers/mssql-driver.test.ts` — `?` → `@pN` translation, discovery queries
  - `execution/query-executor.test.ts` — lifecycle (connect/execute/disconnect in finally), timeout handling, concurrency limiting
  - `execution/memory-tracker.test.ts` — allocate/release, global cap
  - `execution/concurrency-limiter.test.ts` — semaphore behavior, queue timeout
  - **Integration tests** (optional, require actual databases): connect to real MySQL/Postgres, run discovery queries

**Success criteria:** Can programmatically connect to a database, execute a query, and receive a typed result. Placeholder translation works across all drivers. Concurrency limiter prevents overload.

---

#### Phase 3: Security Layer

**Goal:** Statement classification, guardrail enforcement, error sanitization, rate limiting.

**Tasks:**

- [ ] **Statement classifier** — `src/lib/security/statement-classifier.ts`
  - `classifyStatement(sql: string): StatementType`
  - Algorithm:
    1. Strip leading whitespace
    2. Strip leading SQL comments: `-- ...`, `/* ... */` (including nested), `# ...` (MySQL)
    3. Extract first keyword (case-insensitive)
    4. Map to `StatementType` enum: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, `SET`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `WITH`, `CALL`, `EXEC`, `LOAD`, `COPY`, `USE`, `UNKNOWN`
  - Handle `WITH ... SELECT` (CTE reads) vs `WITH ... INSERT/UPDATE/DELETE` (CTE writes): check the first non-CTE statement keyword
  - Handle `EXPLAIN INSERT ...`: classify as `EXPLAIN` (read-only analysis)
  - Known limitations (document clearly): cannot detect dynamic SQL inside stored procedures, cannot catch `SELECT ... INTO OUTFILE`

- [ ] **Multi-statement detection** — within `statement-classifier.ts`
  - `containsMultipleStatements(sql: string): boolean`
  - Detect unquoted semicolons (skip semicolons inside string literals and comments)
  - **Default: reject multi-statement queries** — they bypass per-statement guardrail analysis
  - Configurable via `MCP_SQL_ALLOW_MULTI_STATEMENT=true` for trusted environments

- [ ] **Guardrail enforcer** — `src/lib/security/guardrail-enforcer.ts`
  - `enforceGuardrails(sql: string, profile: ConnectionProfile): void | never`
  - Pipeline:
    1. Classify statement type
    2. Check multi-statement (reject if detected and not allowed)
    3. Check default-blocked statements (LOAD, COPY, xp_cmdshell, EXEC) — **always blocked unless explicitly allowed**
    4. Check `readonly` (only allow READONLY_ALLOWED set)
    5. Check `blocked_statements` (profile-specific blocklist)
    6. Check `allowed_databases` — parse SQL for `database.table` patterns, reject unallowed DBs
  - Returns void on pass, throws with `createGuardrailError()` on failure

- [ ] **Error sanitizer** — `src/lib/security/error-sanitizer.ts`
  - `sanitizeDatabaseError(error: Error, profileName: string): string`
  - Strip: IP addresses (IPv4, IPv6), hostnames, port numbers, file paths, SQL fragments, usernames, connection strings
  - Preserve: error code (e.g., MySQL 1064, PG 42601), error class name, generic description
  - Output format: `sql_execute error: [profileName] ErrorClassName (code: XXXXX)`
  - Tested against real error messages from all four drivers

- [ ] **Rate limiter** — `src/lib/security/rate-limiter.ts`
  - Carry forward from mcp-curl pattern: per-key fixed-window maps
  - Two dimensions: per-profile (60 req/min default), per-client (300 req/min default)
  - Periodic cleanup on `unref()`'d interval

- [ ] **Input validation** — `src/lib/security/input-validation.ts`
  - `safeStringCompare()` — timing-safe comparison for auth tokens
  - `isValidSessionId()` — UUID v4 format validation
  - `validateSqlInput(sql: string)` — max length check, Unicode bidi/zero-width character detection

- [ ] **Tests for Phase 3:**
  - `security/statement-classifier.test.ts` — **extensive**: simple statements, comment-prefixed, CTE-wrapped, multi-line, Unicode tricks, `WITH ... SELECT` vs `WITH ... DELETE`, `EXPLAIN INSERT`, `LOAD DATA INFILE`, `COPY ... FROM`
  - `security/guardrail-enforcer.test.ts` — readonly mode bypass attempts, blocklist enforcement, default-blocked statements, allowed_databases parsing
  - `security/error-sanitizer.test.ts` — real error messages from MySQL, Postgres, MSSQL with embedded hostnames/IPs/SQL
  - `security/rate-limiter.test.ts` — window expiry, per-key limits, cleanup

**Success criteria:** Statement classifier correctly identifies all standard SQL statement types including comment-bypasses and CTEs. Guardrails block dangerous statements. Error messages contain zero credentials or connection details.

---

#### Phase 4: Response Processing + File Management

**Goal:** Format results, handle large result sets, manage temp files.

**Tasks:**

- [ ] **Response formatter** — `src/lib/response/formatter.ts`
  - `formatQueryResult(raw: RawQueryResult, options: FormatOptions): string`
  - Output JSON structure:
    ```json
    {
      "columns": [{"name": "id", "type": "int"}, ...],
      "rows": [[1, "alice"], ...],
      "row_count": 2,
      "affected_rows": 0,
      "query_time_ms": 12,
      "truncated": false,
      "saved_to_file": null,
      "profile": "staging",
      "statement_type": "SELECT"
    }
    ```
  - DDL/DML without rows: `columns: [], rows: [], affected_rows: N, statement_type: "DDL"`
  - Handle null values, binary data (base64 encode), dates (ISO 8601 strings)

- [ ] **Response processor** — `src/lib/response/processor.ts`
  - `processQueryResult(raw: RawQueryResult, options: ProcessOptions): ProcessedResult`
  - Pipeline:
    1. Apply `max_rows` truncation (stop reading after N rows, set `truncated: true`)
    2. Format to JSON string
    3. Check byte size against `maxResultSize`
    4. If over limit OR `save_to_file` flag: save full result to file, truncate inline to preview (first N rows + metadata)
    5. Return `ProcessedResult` (discriminated union: inline vs saved-to-file)

- [ ] **File saver** — `src/lib/response/file-saver.ts`
  - Carry forward from mcp-curl: `createSafeFilenameBase()`, safe filename generation, 0o600 permissions, realpath verification
  - Naming: `{profile}_{table_or_hash}_{timestamp}.json`

- [ ] **Temp manager** — `src/lib/files/temp-manager.ts`
  - Carry forward from mcp-curl: lazy singleton, orphan cleanup (`mcp-sql-*` prefix), promise caching, backoff on failure

- [ ] **Output dir validation** — `src/lib/files/output-dir.ts`
  - Carry forward: realpath check, blocked directory list, symlink resolution

- [ ] **Tests for Phase 4:**
  - `response/formatter.test.ts` — SELECT results, DDL results, null handling, binary data, empty results
  - `response/processor.test.ts` — inline path, auto-save path, truncation, max_rows interaction
  - `response/file-saver.test.ts` — safe filenames, permissions, Windows reserved names
  - `files/temp-manager.test.ts` — lazy init, orphan cleanup, concurrent access

**Success criteria:** Results format correctly for all statement types. Large results auto-save with preview. Temp files are cleaned up on shutdown.

---

#### Phase 5: Extensible Layer + Transports

**Goal:** McpSqlServer builder class, hook system, stdio + HTTP transports. This phase comes before tool registration because the builder and hooks are the foundation tools register through.

**Tasks:**

- [ ] **McpSqlServer builder** — `src/lib/extensible/mcp-sql-server.ts`
  - Fluent API: `.configure()`, `.beforeQuery()`, `.afterQuery()`, `.onError()`, `.registerCustomTool()`, `.disableSqlExecute()`, `.disableQueryFile()`, `.start()`, `.shutdown()`
  - Lifecycle: constructor → configure → hooks → start (freeze config) → running → shutdown
  - `ensureNotStarted()` guards on all mutation methods
  - Config freezing: deep-freeze nested objects (allowedOrigins, defaultHeaders)
  - `KNOWN_CONFIG_KEYS` + `_AssertExhaustive` compile-time check
  - Start rollback: clean up all partially-initialized resources on failure
  - `.utilities()` — cached `InstanceUtilities` for direct query execution (bypasses hooks)
  - `.getConfig()` — returns frozen snapshot
  - `.getProfiles()` — returns frozen profile map (names only, no credentials)

- [ ] **Hook executor** — `src/lib/extensible/hook-executor.ts`
  - Carry forward from mcp-curl: `executeWithHooks<T>(hooks, ctx, executor)`
  - beforeQuery: modify params or short-circuit
  - afterQuery: observe response
  - onError: observe, never fail-fast (suppress hook errors, re-throw original)

- [ ] **Tool wrapper** — `src/lib/extensible/tool-wrapper.ts`
  - Config transforms for sql_execute: apply default profile, merge config-level guardrails, apply outputDir/maxResultSize
  - Enabled/disabled check
  - Hook wrapping
  - **Discovery tools run through hooks** — `list_databases`, `list_tables`, `describe_table` make database connections, so `beforeQuery`/`afterQuery` hooks apply to them for logging, access control, and observability. They are treated as built-in tools (not custom tools).

- [ ] **Transports** — `src/lib/transports/`
  - `stdio.ts` — carry forward from mcp-curl (domain-agnostic)
  - `http.ts` — carry forward: `createHttpApp()`, Express middleware (body limit, Origin validation, auth), session management, SSE routes

- [ ] **CLI entry point** — `src/index.ts`
  - Parse `--config` argument or `MCP_SQL_CONFIG` env var
  - Load profiles
  - Select transport (TRANSPORT env var, default stdio)
  - Start server

- [ ] **Library entry point** — `src/lib.ts`
  - Export `McpSqlServer`, public types, profile loader

- [ ] **Tests for Phase 5:**
  - `extensible/mcp-sql-server.test.ts` — full lifecycle: configure → start → query → shutdown, config freezing, hook registration, start rollback, utility caching
  - `extensible/hook-executor.test.ts` — beforeQuery modify/short-circuit, afterQuery observe, onError suppress
  - `extensible/tool-wrapper.test.ts` — config transforms, disabled tool handling, discovery tools run through hooks
  - `transports/http.test.ts` — middleware stack, session management, auth

**Success criteria:** McpSqlServer can be used programmatically with hooks. Both transports work. CLI starts with `--config` flag.

---

#### Phase 6: MCP Server Integration

**Goal:** Wire everything together — register all tools through the extensible layer, add resources and prompts.

**Tasks:**

- [ ] **Zod schemas** — `src/lib/server/schemas.ts`
  - `SqlExecuteSchema`:
    - `profile`: `z.string().describe("Named connection profile to use")`
    - `sql`: `z.string().min(1).max(LIMITS.MAX_QUERY_LENGTH).describe("SQL statement to execute")`
    - `params`: `z.array(z.unknown()).optional().describe("Parameterized query values (use ? as placeholder)")`
    - `database`: `z.string().optional().describe("Override profile default database")`
    - `include_metadata`: `z.boolean().default(true).describe("Include query timing, column types in response")`
    - `save_to_file`: `z.boolean().optional().describe("Force save results to file")`
  - `QueryFileSchema`:
    - `file_path`: `z.string().describe("Path to saved result file")`
    - `offset`: `z.number().int().min(0).optional().describe("Start at row N (0-based)")`
    - `limit`: `z.number().int().min(1).optional().describe("Return at most N rows")`
    - `columns`: `z.array(z.string()).optional().describe("Return only these columns")`
  - `ListDatabasesSchema`: `{ profile: z.string() }`
  - `ListTablesSchema`: `{ profile: z.string(), database: z.string().optional(), pattern: z.string().optional() }`
  - `DescribeTableSchema`: `{ profile: z.string(), table: z.string(), database: z.string().optional() }`

- [ ] **Tool handlers** — `src/lib/tools/`
  - `sql-execute.ts`:
    1. Resolve profile from loaded config
    2. Enforce guardrails (statement classifier + enforcer)
    3. Check rate limits
    4. Execute query via query-executor
    5. Process response (format + size check + auto-save)
    6. Return MCP tool result
    - Error handling: catch all, sanitize, return `isError: true`
    - Logging: `sql_execute error: [profileName] ErrorClassName`
  - `query-file.ts`:
    1. Validate file path (must be in temp dir, output dir, or cwd)
    2. Read JSON file
    3. Apply offset/limit/columns filtering
    4. Return formatted subset
  - `list-databases.ts`: connect via driver, call `listDatabases()`, filter by `allowed_databases`, format
  - `list-tables.ts`: connect via driver, call `listTables()`, format
  - `describe-table.ts`: connect via driver, call `describeTable()`, format

- [ ] **Tool annotations** — set MCP annotations on each tool:
  - `sql_execute`: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }` — `destructiveHint` is false because the guardrail system handles safety; setting it true would force confirmation prompts on every SELECT
  - `query_file`: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }`
  - `list_databases`, `list_tables`, `describe_table`: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }`

- [ ] **Server factory + registration** — `src/lib/server/`
  - `server-factory.ts` — `createServer()` wrapping `new McpServer({ name: SERVER.NAME, version: SERVER.VERSION })`
  - `registration.ts` — `registerAllCapabilities(server, profiles, config)`: register all 5 tools, resources, prompts
  - `lifecycle.ts` — signal handlers (SIGINT, SIGTERM), graceful shutdown

- [ ] **Resources** — `src/lib/resources/profile-docs.ts`
  - MCP resource listing available profiles (names only, no credentials) with their driver type, database, and guardrail status

- [ ] **Prompts** — `src/lib/prompts/`
  - `data-exploration.ts` — guides AI through: list databases → list tables → describe → query workflow
  - `schema-discovery.ts` — teaches AI to use discovery tools effectively

- [ ] **Tests for Phase 6:**
  - `tools/sql-execute.test.ts` — happy path, guardrail rejection, rate limit, error sanitization, auto-save trigger
  - `tools/query-file.test.ts` — paging, column filtering, path validation
  - `tools/list-databases.test.ts` — allowed_databases filtering
  - `server/schemas.test.ts` — Zod validation, edge cases
  - `server/registration.test.ts` — all tools registered, discovery tools wired through hooks

**Success criteria:** All 5 tools work end-to-end with mocked database drivers. Guardrails enforce on sql_execute. Discovery tools return properly formatted results and trigger hooks.

---

#### Phase 7: Polish + Documentation

**Goal:** CLAUDE.md, README, edge case hardening, integration test suite.

**Tasks:**

- [ ] **CLAUDE.md** — comprehensive build commands, architecture, security documentation (modeled on mcp-curl's)
- [ ] **README.md** — installation, quick start, YAML config examples, tool reference, security model
- [ ] **Integration test suite** — tests against real database containers (optional Docker Compose):
  - MySQL 8.0, PostgreSQL 16, MariaDB 11, MSSQL 2022
  - Full lifecycle: load profiles → connect → discover schema → execute queries → verify results
  - Guardrail enforcement with real databases
  - Error sanitization with real driver error messages
- [ ] **Edge case hardening:**
  - Binary data in results (BLOB, BYTEA)
  - Very long column names / many columns
  - Unicode data in results
  - Null-heavy result sets
  - Empty result sets
  - Very large single-cell values
- [ ] **npm publish preparation** — clean `package.json`, `files` field, `bin` field for CLI

**Success criteria:** Fresh user can install, configure YAML, and start using within 5 minutes. Integration tests pass against real databases.

---

## Alternative Approaches Considered

### Fork mcp-curl and Replace Domain Logic

**Rejected because:** Creates maintenance burden linking two unrelated projects. Curl-specific assumptions (URL validation, SSRF protection, `--resolve` DNS pinning) are deeply embedded and would require extensive removal rather than simple replacement. A fresh codebase with pattern-copying is cleaner.

### Use an ORM (Knex, Prisma, TypeORM)

**Rejected because:** Violates the proxy philosophy. The MCP should pass SQL through, not abstract it. ORMs add a translation layer that would obscure what SQL actually executes, complicate debugging, and restrict the AI to the ORM's query builder syntax.

### Connection Pooling from Day 1

**Rejected because:** AI exploration is low-frequency (seconds to minutes between queries). Connection pooling adds complexity (idle connection management, pool exhaustion, leaked connection detection) that doesn't pay off at this frequency. The architecture supports upgrading to pooling later without API changes.

### Full SQL Parser for Guardrails

**Rejected because:** YAGNI. A full SQL parser (e.g., `pgsql-ast-parser`) adds a heavy dependency and still can't catch everything (stored procedures, dynamic SQL). The lightweight prefix classifier is sufficient for catching obvious dangerous statements. Guardrails are explicitly documented as a convenience safety net, not a security boundary. Database-level permissions are the primary defense.

## Acceptance Criteria

### Functional Requirements

- [ ] AI can query MySQL, MariaDB, PostgreSQL, and MSSQL via named profiles
- [ ] YAML connection profiles load with `${ENV_VAR}` interpolation
- [ ] Schema discovery tools (list_databases, list_tables, describe_table) work across all supported databases
- [ ] Parameterized queries work with `?` placeholders translated per driver
- [ ] Large results (>500KB) auto-save to temp files with preview inline
- [ ] query_file tool supports offset/limit paging through saved results
- [ ] Guardrails enforce: readonly, blocked_statements, max_rows, max_execution_time, allowed_databases
- [ ] Multi-statement queries are rejected by default
- [ ] Dangerous DB-specific statements (LOAD DATA INFILE, COPY FROM, xp_cmdshell) blocked by default
- [ ] Both stdio and HTTP transports work
- [ ] McpSqlServer builder API supports hooks (beforeQuery/afterQuery/onError) and custom tools

### Non-Functional Requirements

- [ ] Error messages never contain credentials, hostnames, ports, or SQL content
- [ ] Per-profile concurrency limit prevents database overload (default: 5)
- [ ] Global memory limit prevents OOM (100MB)
- [ ] Rate limiting: 60 req/min per profile, 300 req/min per client
- [ ] Connection timeout: 10s default. Query timeout: 30s default
- [ ] Config frozen after start() — immutable at runtime
- [ ] Temp files cleaned up on shutdown, orphans cleaned on startup
- [ ] File permissions: 0o700 dirs, 0o600 files

### Quality Gates

- [ ] All unit tests pass with >80% coverage on security modules
- [ ] Statement classifier tested against bypass attempts (comments, CTEs, Unicode)
- [ ] Error sanitizer tested against real driver error messages
- [ ] Integration tests pass against real MySQL and PostgreSQL instances
- [ ] `npm run build` produces clean output with type declarations
- [ ] CLAUDE.md documents architecture, security, build commands

## Success Metrics

- AI can go from zero to querying a database in under 5 minutes (install + YAML config + first query)
- Schema discovery works identically across all 4 database types for the AI
- Zero credential leakage in error responses (verified by security tests)
- Large result handling is transparent to the AI (auto-save + query_file workflow)

## Dependencies & Prerequisites

| Dependency | Purpose | Version |
|-----------|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation | Latest |
| `zod` | Schema validation | ^3.x |
| `js-yaml` | YAML parsing (with JSON_SCHEMA safety) | ^4.x |
| `express` | HTTP transport | ^4.x |
| `mysql2` | MySQL/MariaDB driver | ^3.x |
| `pg` | PostgreSQL driver | ^8.x |
| `mssql` | Microsoft SQL Server driver | ^11.x |
| `tsup` | Build tooling | ^8.x |
| `vitest` | Testing framework | ^4.x |
| `typescript` | Language | ^5.x |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Statement classifier bypassed via SQL comments/encoding | Medium | High | Extensive test suite, document as advisory (DB permissions are primary defense) |
| Driver error messages leak connection details | High | High | Error sanitizer with regex + driver-specific patterns, tested against real errors |
| AI sends expensive queries that overload database | Medium | High | Per-profile concurrency limiter + query timeout + rate limiting |
| ${ENV_VAR} undefined at startup causes confusing errors | Medium | Medium | Fail-fast validation during YAML loading for required fields |
| Large result sets cause OOM | Low | High | Global memory tracker (100MB cap) + per-query size limits + streaming where drivers support it |
| Multi-statement injection bypasses guardrails | Medium | High | Default block multi-statements, semicolon detection with string-literal awareness |

## Future Considerations

- **Connection pooling** — upgrade from connect-per-query if performance demands
- **Transaction support** — session-pinned connections for BEGIN/COMMIT/ROLLBACK
- **Query templates** — YAML-defined query tools (like mcp-curl's YAML API schemas) for common operations
- **Column-level data masking** — redact PII/sensitive columns in results
- **Audit logging** — log statement type, profile, timing, row count (never SQL content)
- **Config hot-reload** — SIGHUP to reload YAML without restart
- **Credential refresh** — re-read env vars on each connection for secret rotation
- **Additional drivers** — SQLite, Oracle, CockroachDB
- **CSV/JSONL export** — alternative formats for saved result files
- **Startup connection test** — verify each profile can connect during startup

## References & Research

### Internal References (mcp-curl patterns)

- Builder pattern: `src/lib/extensible/mcp-curl-server.ts`
- Hook system: `src/lib/extensible/hook-executor.ts`
- Transport layer: `src/lib/transports/http.ts`, `src/lib/transports/stdio.ts`
- Config management: `src/lib/config/defaults.ts`, `src/lib/config/environment.ts`
- YAML loading: `src/lib/schema/loader.ts`, `src/lib/schema/validator.ts`
- Rate limiter: `src/lib/security/rate-limiter.ts`
- Memory tracker: `src/lib/execution/memory-tracker.ts`
- Temp files: `src/lib/files/temp-manager.ts`
- File saver: `src/lib/response/file-saver.ts`
- Response processor: `src/lib/response/processor.ts`
- Error utilities: `src/lib/utils/error.ts`
- Compile-time config check: `src/lib/extensible/mcp-curl-server.ts:76-84`

### Brainstorm Document

- `docs/brainstorms/2026-03-12-mcp-sql-proxy-brainstorm.md` — all key decisions, architecture blueprint, resolved questions

### Key Learnings from mcp-curl Development

- Always validate config keys explicitly (silent absorption bug in PR #16)
- Cache utilities after start() (not per-call — fixed in PR #18)
- Minimal error logging from day one (security fix in v2.0.1)
- Pure security predicates: export functions, not data
- Start() rollback: clean up partial state on failure
- Unicode bidi validation on all string inputs (commit 0fb117c)
- Custom tools bypass hooks — decide hook scope for discovery tools early

---

## Phase Tracking

| Phase | Name | Status | Key Deliverables |
|-------|------|--------|-----------------|
| 1 | Foundation (Scaffold + Config + Profiles) | Not Started | Project scaffold, config layer, types, error utils, YAML profile loader |
| 2 | Database Drivers + Execution | Not Started | DatabaseDriver interface, MySQL/Postgres/MSSQL drivers, query executor, memory tracker, concurrency limiter |
| 3 | Security Layer | Not Started | Statement classifier, multi-statement detection, guardrail enforcer, error sanitizer, rate limiter, input validation |
| 4 | Response Processing + File Management | Not Started | Response formatter, response processor, file saver, temp manager, output dir validation |
| 5 | Extensible Layer + Transports | Not Started | McpSqlServer builder, hook executor, tool wrapper, stdio + HTTP transports, CLI + lib entry points |
| 6 | MCP Server Integration | Not Started | Zod schemas, tool handlers (sql_execute, query_file, list_databases, list_tables, describe_table), registration, resources, prompts |
| 7 | Polish + Documentation | Not Started | CLAUDE.md, README, integration tests, edge case hardening, npm publish prep |

### Phase Dependencies

```
Phase 1 (Foundation)
  └─▶ Phase 2 (Drivers)
        └─▶ Phase 3 (Security)
              └─▶ Phase 4 (Response)
                    └─▶ Phase 5 (Extensible)
                          └─▶ Phase 6 (Integration)
                                └─▶ Phase 7 (Polish)
```

### Progress Notes

_Update this section as phases are completed._

| Date | Phase | Notes |
|------|-------|-------|
| | | |
