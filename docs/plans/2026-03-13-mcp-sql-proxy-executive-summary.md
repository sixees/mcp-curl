# MCP SQL Proxy Server — Executive Summary

**Date:** 2026-03-13
**Project:** mcp-sql
**Status:** Pending Approval
**Detailed Plan:** [docs/plans/2026-03-12-feat-mcp-sql-proxy-server-plan.md](./2026-03-12-feat-mcp-sql-proxy-server-plan.md)

---

## What We Want to Build

A server that gives AI assistants the ability to query company databases directly during conversations. Instead of employees manually running queries and pasting results into an AI chat, the AI can look at databases itself — discovering what tables exist, understanding their structure, and running queries to answer questions.

The server supports MySQL, MariaDB, PostgreSQL, and Microsoft SQL Server — covering the major relational databases used across most organisations.

## The Problem It Solves

Today, when an AI assistant needs data to answer a question, a human must:

1. Understand what the AI needs
2. Write and run the SQL query themselves
3. Copy/paste the results back into the conversation
4. Repeat for follow-up questions

This is slow, error-prone, and creates a bottleneck. The AI cannot independently explore data, discover relationships between tables, or iterate on queries to refine its analysis.

## How It Works (Non-Technical)

**For end users (AI conversations):**
- The AI can list databases and tables, examine their structure, and run queries — all within the conversation
- Results come back as structured data the AI can reason about
- Large result sets are automatically saved to files so they don't overwhelm the conversation

**For administrators (setup and configuration):**
- Database connections are defined in a simple configuration file with named profiles (e.g., "production-readonly", "staging", "analytics")
- Database passwords are never stored in the config file — they reference secure environment variables
- Each profile can have its own safety rules (read-only mode, blocked operations, row limits, etc.)

**Example interaction:**
> **User:** "What were our top 10 products by revenue last quarter?"
>
> **AI:** *(uses list_tables to find the relevant tables, describe_table to understand their columns, then sql_execute to run the query)* "Based on the orders and products tables, here are your top 10 products by revenue for Q4 2025..."

## Security Model

Security is layered — multiple independent safeguards work together:

| Layer | What It Does |
|-------|-------------|
| **Database permissions** | Primary defence. The database user on each profile has only the permissions it needs. This is controlled by your DBA, not this tool. |
| **Connection profiles** | Credentials never appear in AI conversations. The AI only sees profile names like "analytics" — never hostnames, usernames, or passwords. |
| **Configurable guardrails** | Per-profile safety rules: read-only mode, blocked destructive operations (DROP, TRUNCATE), row limits, query timeouts, database access restrictions. |
| **Dangerous command blocking** | Database-specific dangerous commands (file system access, OS command execution) are blocked by default across all profiles. |
| **Rate limiting** | Prevents excessive querying — protects databases from being overwhelmed. |
| **Error sanitisation** | Error messages returned to the AI never contain credentials, server addresses, or raw SQL — preventing accidental information disclosure. |
| **Resource limits** | Memory caps, query timeouts, and concurrency limits prevent any single query or session from overloading the system. |

**Key principle:** The server is a proxy with guardrails, not a security boundary. Database-level permissions (managed by your DBA) remain the primary access control. The guardrails are a convenience safety net on top.

## Why a New Project

We previously built a successful MCP server for HTTP/API requests (mcp-curl), which is in production and has been well-received. That project established robust architectural patterns, security practices, and code quality standards.

Rather than forking that project (which would carry HTTP-specific logic we'd need to remove), we are building mcp-sql as a **new project that carries forward the proven architectural patterns** from mcp-curl. This gives us a clean codebase purpose-built for SQL while retaining all the lessons learned.

## Delivery Phases

The project is structured into 7 sequential phases, each building on the previous:

| Phase | What Gets Built | What It Enables |
|-------|----------------|----------------|
| **1. Foundation** | Project structure, configuration system, database profile management | Config file can be written and validated |
| **2. Database Connectivity** | Drivers for MySQL, PostgreSQL, MSSQL; connection management | Can connect to databases and run queries programmatically |
| **3. Security** | Query classification, guardrail enforcement, error sanitisation, rate limiting | Dangerous operations blocked, credentials protected |
| **4. Result Handling** | Response formatting, large result file management | Results properly formatted for AI consumption, large results saved to files |
| **5. Server Framework** | Extensible server architecture, communication transports | Server can run and accept connections from AI clients |
| **6. Full Integration** | All AI-facing tools wired together and tested | AI can discover schemas, run queries, page through results |
| **7. Documentation & Polish** | Documentation, integration testing, edge case hardening | Ready for distribution and adoption by other teams |

Each phase has defined success criteria and a test suite. Phases can be demonstrated independently — for example, after Phase 2 we can show live database connectivity, and after Phase 3 we can demonstrate the security guardrails.

## Supported Databases

| Database | Version | Notes |
|----------|---------|-------|
| MySQL | 5.7.8+ | Covers most MySQL deployments |
| MariaDB | 10.x+ | Shares the MySQL driver; treated as compatible |
| PostgreSQL | 12+ | Most common open-source enterprise database |
| Microsoft SQL Server | 2017+ | Covers enterprise Windows-based environments |

Additional databases (SQLite, Oracle, CockroachDB) can be added later by implementing a single driver interface.

## Risks and Mitigations

| Risk | How We Address It |
|------|------------------|
| AI runs destructive queries (DROP TABLE, etc.) | Configurable guardrails: read-only mode, statement blocking, dangerous commands blocked by default. Database permissions are the primary defence. |
| Credential exposure in AI conversations | Credentials are never in the conversation. Profile names only. Error messages are sanitised to remove all connection details. |
| Database overload from AI queries | Per-profile concurrency limits (max 5 simultaneous connections), rate limiting (60 queries/min per profile), query timeouts (30s default). |
| Large query results overwhelm AI context | Automatic file saving for results exceeding configurable size limits. AI receives a summary with a file reference for paging through full results. |
| Memory exhaustion from concurrent queries | 100MB global memory cap across all active queries. New queries rejected when limit is reached. |

## Future Roadmap (Post-Launch)

These capabilities are explicitly deferred from v1 to keep scope focused:

- **Connection pooling** — Upgrade for higher-frequency use cases
- **Transaction support** — Multi-step write operations (BEGIN/COMMIT/ROLLBACK)
- **Audit logging** — Track what was queried, by whom, and when
- **Data masking** — Redact sensitive columns (PII, financial data) from results
- **Pre-built query templates** — Define common queries in config for one-click AI access
- **Additional databases** — SQLite, Oracle, CockroachDB

## Dependencies

The project uses only well-established, actively maintained open-source libraries:

- **MCP SDK** — Anthropic's official Model Context Protocol SDK
- **Database drivers** — mysql2, pg (node-postgres), mssql — all industry-standard Node.js database clients with millions of weekly downloads
- **Supporting libraries** — Zod (validation), js-yaml (configuration), Express (HTTP transport)

No novel or experimental dependencies. All libraries are MIT or similarly licensed.

## Recommendation

This project directly enables AI-powered data exploration across our existing database infrastructure. It builds on proven patterns from our successful mcp-curl server, addresses security comprehensively through layered defences, and is scoped tightly to deliver value without over-engineering.

We recommend approval to proceed with Phase 1.
