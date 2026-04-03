# MCP SQL Proxy Server — Brainstorm

**Date:** 2026-03-12
**Status:** Reviewed
**Based on:** Architecture analysis of mcp-curl v2.0.1

---

## What We're Building

An MCP server that proxies SQL queries from AI clients to relational databases (MariaDB, MySQL, PostgreSQL, Microsoft SQL Server). The server acts as a transparent proxy — it receives SQL from the AI, forwards it to the configured database, and returns structured results. It includes schema discovery tools that abstract cross-database dialect differences, making AI exploration database-agnostic.

**Primary use case:** AI agents interactively exploring and querying databases during conversations — schema discovery, ad-hoc queries, data analysis.

---

## Why This Approach

### New Project, Not a Fork

The mcp-curl codebase has excellent architecture, but forking it would create maintenance burden and carry curl-specific assumptions into the new codebase. Instead, we'll:

1. **Extract proven patterns** — Builder pattern, hook system, transport layer, config management, security layering, error handling, testing patterns
2. **Build fresh** — New project with SQL-specific logic from the ground up
3. **Share nothing at runtime** — No shared dependency between the two projects

This gives us clean separation while preserving all architectural learnings.

### Patterns to Carry Forward from mcp-curl

| Pattern | mcp-curl Implementation | SQL Proxy Adaptation |
|---------|------------------------|---------------------|
| **Builder with frozen config** | `McpCurlServer` — fluent `.configure()`, config frozen on `.start()` | `McpSqlServer` — identical lifecycle |
| **Hook system** | `beforeRequest` / `afterResponse` / `onError` with fail-fast semantics | Same pattern — `beforeQuery` / `afterQuery` / `onError` |
| **Three-tier config** | Programmatic > env var > built-in default | Same pattern for all SQL settings |
| **Pure config predicates + stateful security** | Frozen blocklists with pure `isBlocked*()` functions, stateful validation layer above | Frozen guardrail rules (statement blocklists), stateful connection validation layer |
| **Immutable security data** | `Object.freeze()` on all blocklists, `ReadonlySet` | Same — frozen allowed/blocked statement lists |
| **Minimal error logging** | `tool_name error: [hostname] ErrorClassName` — no message content | `sql_execute error: [profile_name] ErrorClassName` |
| **Barrel files with test-only exclusions** | `index.ts` controls public surface, test utilities explicitly excluded | Same |
| **Consistent error factories** | `createValidationError()`, `createAccessError()`, etc. | Same utility functions |
| **Transport abstraction** | Stdio + HTTP with shared server creation | Reuse as-is |
| **Session management** | `SessionManager` with cleanup intervals, max sessions | Reuse as-is |
| **Temp file management** | Lazy singleton, orphan cleanup, promise caching | Reuse pattern for large result set storage |
| **Memory tracking** | Global allocator with per-request and global limits | Same — track result set memory |
| **Co-located tests** | `*.test.ts` next to source, test-only exports | Same |
| **Compile-time exhaustive config check** | `_AssertExhaustive` type ensures config keys array matches interface | Same |

---

## Key Decisions

### 1. Connection Management: Named Profiles via YAML

Connections are defined as named profiles in a YAML configuration file. AI agents select profiles by name — **raw credentials never appear in the AI conversation**.

```yaml
profiles:
  production-readonly:
    driver: mysql
    host: db.prod.internal
    port: 3306
    database: app_production
    user: readonly_user
    password: ${DB_PROD_PASSWORD}  # env var interpolation
    guardrails:
      readonly: true

  staging:
    driver: postgres
    host: db.staging.internal
    port: 5432
    database: app_staging
    user: dev_user
    password: ${DB_STAGING_PASSWORD}
    guardrails:
      blocked_statements: [DROP, TRUNCATE]
      max_rows: 10000
```

**Rationale:** Mirrors the YAML schema system from mcp-curl. Keeps secrets manageable (env var interpolation for passwords), profiles version-controllable (minus secrets), and the AI never sees connection strings.

### 2. Connection Strategy: Connect Per Query

Each query opens a fresh connection, executes, and closes. No connection pooling.

**Rationale:** AI exploration is low-frequency. Simplicity wins — no leaked connections, no pool management, clean shutdown. If performance becomes an issue later, the architecture allows upgrading to lazy pooling without breaking the API.

### 3. SQL Safety: Configurable Guardrails (Off by Default)

Per-profile guardrails that can be enabled:
- **`readonly`**: Only allow SELECT, SHOW, DESCRIBE, EXPLAIN, and schema discovery queries
- **`blocked_statements`**: Blocklist specific statement types (DROP, TRUNCATE, ALTER, etc.)
- **`max_rows`**: Limit result set size at the query level (adds LIMIT clause or warns)
- **`max_execution_time`**: Query timeout to prevent runaway queries
- **`allowed_databases`**: Whitelist databases the AI can access within a connection

**Guardrails are off by default** — the MCP is a proxy. Security is layered: DB-level permissions are the primary defense, guardrails are a convenience safety net.

**Implementation:** Statement type detection via lightweight prefix parsing (not full SQL parsing). We examine the first meaningful token after stripping comments/whitespace. This is intentionally simple — we're not building a SQL parser, just catching obvious cases.

### 4. Result Format: JSON with Structured Metadata

```json
{
  "columns": [
    {"name": "id", "type": "int"},
    {"name": "email", "type": "varchar"}
  ],
  "rows": [[1, "alice@example.com"], [2, "bob@example.com"]],
  "row_count": 2,
  "affected_rows": 0,
  "query_time_ms": 12,
  "truncated": false,
  "saved_to_file": null
}
```

**Rationale:** More token-efficient than array-of-objects for large result sets. Column metadata (including types) aids AI understanding. The `rows` array-of-arrays format avoids repeating column names per row.

### 5. Large Result Handling: Auto-Save + Summary

When results exceed `maxResultSize` (configurable, default 500KB):
1. Full results saved to a temp file (JSON format)
2. Inline response contains: column metadata, row count, first N rows as preview, file path
3. AI can use a `query_file` tool to read/page through the saved file

**Mirrors mcp-curl's pattern exactly** — proven approach, familiar to users of the existing server.

### 6. Tools

**Primary tools:**
- **`sql_execute`** — Execute arbitrary SQL against a named profile. Returns structured metadata response.
- **`query_file`** — Read/page through saved result files (analogous to mcp-curl's `jq_query`)

**Schema discovery tools (abstract cross-DB differences):**
- **`list_databases`** — List available databases on a profile's server
- **`list_tables`** — List tables in a database (with optional schema/pattern filter)
- **`describe_table`** — Column names, types, keys, constraints for a table

**Rationale:** Discovery tools abstract MySQL's `SHOW TABLES` vs Postgres's `\dt` vs MSSQL's `sp_help`. The AI doesn't need to know the dialect — just the profile name.

### 7. Database Driver Strategy

Use established Node.js database clients:
- **MySQL/MariaDB:** `mysql2` (Promise API)
- **PostgreSQL:** `pg` (node-postgres)
- **Microsoft SQL Server:** `tedious` or `mssql`

Each driver wrapped behind a common `DatabaseDriver` interface:
```typescript
interface DatabaseDriver {
  connect(profile: ConnectionProfile): Promise<Connection>;
  execute(conn: Connection, sql: string, params?: unknown[]): Promise<QueryResult>;
  disconnect(conn: Connection): Promise<void>;
  listDatabases(conn: Connection): Promise<string[]>;
  listTables(conn: Connection, database?: string): Promise<TableInfo[]>;
  describeTable(conn: Connection, table: string): Promise<ColumnInfo[]>;
}
```

**Rationale:** Abstracts dialect differences behind a clean interface. Each driver implements discovery methods using the DB-specific syntax. Adding a new database means implementing one interface. The optional `params` array enables native prepared statements when the AI uses parameterized mode.

### 8. SSL/TLS for Database Connections

Profiles support optional SSL/TLS configuration:
```yaml
profiles:
  production-readonly:
    driver: mysql
    host: db.prod.internal
    ssl:
      enabled: true           # Enable TLS (some drivers auto-negotiate)
      ca: ${DB_SSL_CA_PATH}   # CA certificate file path
      reject_unauthorized: true  # Reject self-signed (default: true)
```

**Rationale:** Production databases frequently require encrypted connections. SSL config should be per-profile since different databases may have different certificate requirements. Defaults to enabled where the driver supports it.

### 9. Timeout Strategy

Two distinct timeouts per profile:
- **`connection_timeout`**: Max time to establish a connection (default: 10s). Prevents hanging on unreachable hosts.
- **`query_timeout`**: Max query execution time (default: 30s, configurable per-profile via `max_execution_time` guardrail). Prevents runaway queries.

Both are configurable per-profile in YAML and overridable via `McpSqlServer.configure()` for global defaults.

### 10. Tool Schemas

**`sql_execute` input schema:**
```typescript
{
  profile: string;          // Required — named connection profile
  sql: string;              // Required — SQL statement to execute
  params?: unknown[];       // Optional — parameterized query values
  database?: string;        // Optional — override profile's default database
  include_metadata?: boolean; // Optional — include query timing, column types (default: true)
  save_to_file?: boolean;   // Optional — force save results to file
}
```

**`query_file` input schema:**
```typescript
{
  file_path: string;        // Required — path to saved result file
  offset?: number;          // Optional — start at row N (0-based)
  limit?: number;           // Optional — return at most N rows
  columns?: string[];       // Optional — return only these columns
}
```

**Discovery tools** all take `profile: string` as required input, plus tool-specific optional filters (`database`, `schema`, `table_pattern`).

### 11. Error Handling for Connection Failures

When a database is unreachable or credentials are invalid:
- Return a structured MCP error response (`isError: true`) — never throw
- Error message includes the profile name and error class, but **never** the hostname, port, username, or connection string
- Specific error categories: `ConnectionRefused`, `AuthenticationFailed`, `DatabaseNotFound`, `ConnectionTimeout`, `SSLError`
- Error format: `sql_execute error: [profile_name] ConnectionRefused` — consistent with mcp-curl's minimal logging pattern

### 12. `max_rows` Guardrail Strategy

The `max_rows` guardrail uses a **warn-and-truncate** strategy, not query rewriting:
- Do NOT inject `LIMIT` into the SQL (fragile with CTEs, subqueries, UNIONs, and database dialects)
- Execute the query as-is, but stop reading rows from the result stream after `max_rows` is reached
- Return `truncated: true` in the response metadata with a message indicating the limit was hit
- This keeps the proxy philosophy intact — we don't modify the SQL, we limit what we return

---

## Architecture Blueprint

### Module Map

```
src/lib/
├── config/              # Constants, limits, env vars, server identity
│   └── security/        # Guardrail patterns, blocked statements, validation
├── types/               # TypeScript types: query result, session, connection profile, public API
├── security/            # Stateful: connection validation, rate limiter, guardrail enforcement
├── drivers/             # Database drivers: mysql, postgres, mssql (behind common interface)
├── execution/           # Query execution: driver selection, memory tracking, timeout enforcement
├── files/               # Temp directory manager, output directory validation
├── response/            # Result processing: formatter, file saver, processor (size check + auto-save)
├── server/              # MCP server: factory, Zod schemas, registration, lifecycle/shutdown
├── session/             # HTTP session manager (reuse from mcp-curl)
├── tools/               # Tool handlers: sql_execute, query_file, list_databases, list_tables, describe_table
├── resources/           # MCP resources: connection profile documentation
├── prompts/             # MCP prompts: data-exploration, schema-discovery
├── transports/          # Transport implementations: stdio, HTTP (reuse from mcp-curl)
├── schema/              # YAML profile system: types, validator, loader
├── extensible/          # McpSqlServer class, hooks executor, tool wrapper
└── utils/               # Shared utilities: error handling, SQL statement detection
```

### Security Layers

1. **Database-level permissions** — Primary defense. The DB user on each profile should have only the permissions needed.
2. **Profile-level guardrails** — Configurable per-profile: readonly mode, statement blocklists, row limits, execution timeouts.
3. **Server-level limits** — Rate limiting (per-profile, per-client), global memory cap, max result size, max query length.
4. **Transport-level auth** — Bearer token for HTTP transport, Origin validation (reuse from mcp-curl).
5. **Connection validation** — Verify profile exists and is configured before attempting connection. No credential leakage in error messages.

### Design Principles

1. **Composition over inheritance** — `McpSqlServer` composes `McpServer`, doesn't extend it
2. **Builder pattern with frozen config** — Fluent API, config immutable after `start()`
3. **Pure predicates in config, stateful logic in security** — Testable guardrail checks without mocking
4. **Defense in depth** — DB permissions + guardrails + rate limits + transport auth
5. **Minimal error logging** — Profile name + error class only, never SQL content or credentials
6. **Connect per query** — Simplicity for exploration use case
7. **Proxy philosophy** — Pass SQL through, don't interpret it. Guardrails are optional safety nets, not query rewriters.

---

## Resolved Questions

### 1. Environment Variable Interpolation in YAML
**Decision:** Yes — support `${ENV_VAR}` syntax in YAML string values for secret injection. Simple, widely understood pattern. Passwords stay out of config files.

### 2. Transaction Support
**Decision:** No transactions in v1. Each query is atomic. Connect-per-query model stays clean. Transactions can be added later via session-pinned connections if write workflows demand it.

### 3. Prepared Statements / Parameterization
**Decision:** Support both modes. Accept raw SQL AND parameterized queries (`sql` + `params` array). Parameterized mode uses the driver's native prepared statements. Safer when AI queries involve untrusted data.

### 4. Result File Format
**Decision:** JSON. Same structured format as inline responses. Consistent, parseable by the `query_file` tool. Larger file size is acceptable given the AI exploration use case.

---

## What NOT to Build (YAGNI)

- **Connection pooling** — Connect-per-query is sufficient for AI exploration frequency
- **Transaction support** — v1 is single-statement atomic; revisit if needed
- **Query caching** — AI exploration queries are rarely repeated
- **Schema migration tools** — Out of scope; use dedicated migration tools
- **ORM-like abstractions** — We're a proxy, not an ORM
- **Query optimization/rewriting** — Proxy philosophy means pass-through
- **Multi-statement execution** — Single statement per call
- **Stored procedure management** — Can call them via `sql_execute`, don't need dedicated tools
- **Real-time streaming of results** — Save to file for large results instead
- **CSV/JSONL export formats** — JSON only for v1; add formats if needed later
