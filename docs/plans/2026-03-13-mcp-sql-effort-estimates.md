# MCP SQL Proxy Server — Effort Estimates

**Date:** 2026-03-13
**Plan:** [docs/plans/2026-03-12-feat-mcp-sql-proxy-server-plan.md](./2026-03-12-feat-mcp-sql-proxy-server-plan.md)

---

## Phase Sizing Summary

| Phase | Name | Size | Effort % | Source Files | Test Files | New vs. Pattern-Copy |
|:-----:|------|:----:|:--------:|:------------:|:----------:|---------------------|
| 1 | Foundation (Scaffold + Config + Profiles) | **S** | ~10% | ~12 | ~4 | 30% new, 70% copy |
| 2 | Database Drivers + Execution | **XL** | ~25% | ~8 | ~6 | 80% new, 20% copy |
| 3 | Security Layer | **L** | ~18% | ~6 | ~4 | 60% new, 40% copy |
| 4 | Response Processing + File Management | **S** | ~8% | ~5 | ~4 | 20% new, 80% copy |
| 5 | Extensible Layer + Transports | **M** | ~12% | ~7 | ~4 | 30% new, 70% copy |
| 6 | MCP Server Integration | **M** | ~12% | ~10 | ~5 | 50% new, 50% copy |
| 7 | Polish + Documentation | **L** | ~15% | ~3 | ~8 | 70% new |

```
Phase 1  Foundation          ██░░░░░░░░░░░░░░░░░░  ~10%
Phase 2  Drivers + Execution ██████████░░░░░░░░░░  ~25% 
Phase 3  Security            ████████░░░░░░░░░░░░  ~18%
Phase 4  Response + Files    ██░░░░░░░░░░░░░░░░░░  ~8%
Phase 5  Extensible          ████░░░░░░░░░░░░░░░░  ~12%
Phase 6  Integration         █████░░░░░░░░░░░░░░░  ~12%
Phase 7  Polish + Docs       ███████░░░░░░░░░░░░░  ~15%
```

---

## Phase-by-Phase Breakdown

### Phase 1: Foundation — S (~10%)

**What makes it small:**
- Config layer, types, constants, and error utilities are boilerplate adapted from mcp-curl's established patterns
- Most files are declarative (frozen objects, type definitions, Zod schemas)

**Where the effort is:**
- YAML profile loader with `${ENV_VAR}` interpolation is the only non-trivial piece
- Zod schema for the profile config (guardrails sub-schema, driver enum, SSL config) requires careful design since it's the contract for the entire project

---

### Phase 2: Database Drivers + Execution — XL (~25%)

**Why it's the largest phase:**
- Three separate database drivers (MySQL/MariaDB, PostgreSQL, MSSQL), each implementing 6 interface methods against different underlying npm libraries with different APIs
- Placeholder translation: MySQL uses `?` natively, PostgreSQL needs `?` → `$1, $2, ...`, MSSQL needs `?` → `@p1, @p2, ...`
- Timeout mechanisms differ per driver: MySQL uses `SET max_execution_time`, PostgreSQL uses `SET statement_timeout`, MSSQL uses `request.timeout`
- Discovery SQL differs per database (SHOW DATABASES vs pg_database vs sys.databases)
- SSL/TLS configuration varies per driver library
- Concurrency limiter (per-profile semaphore) is new — no mcp-curl equivalent

**Where the effort is:**
- Getting each driver's quirks right (connection lifecycle, error shapes, type mapping)
- Optional integration tests against real databases add significant time
- The `DatabaseDriver` interface design must accommodate all three drivers without leaking abstractions

**De-risk strategy:** Implement MySQL driver first (simplest — native `?` placeholders, most familiar API), validate the interface works end-to-end, then add PostgreSQL and MSSQL.

---

### Phase 3: Security Layer — L (~18%)

**What makes it large:**
- Statement classifier requires careful comment-stripping (single-line, multi-line, nested, MySQL `#` comments) and CTE handling (`WITH ... SELECT` vs `WITH ... DELETE`)
- Multi-statement detection needs string-literal-aware semicolon parsing (skip `;` inside quotes and comments)
- Error sanitizer must strip hostnames, IPs, ports, SQL fragments, and usernames from error messages produced by 4 different driver libraries — each with different error message formats
- **Testing effort is disproportionate to code volume** — security modules need extensive bypass-attempt test suites

**What's smaller than it looks:**
- Rate limiter is a near-direct copy from mcp-curl
- Input validation (timing-safe compare, session ID format) is a near-direct copy
- Guardrail enforcer is a straightforward pipeline once the classifier exists

**Where the effort is:**
- Writing and validating the statement classifier test suite (comment-prefixed bypass attempts, CTE-wrapped mutations, Unicode tricks, `LOAD DATA INFILE`, `COPY FROM`)
- Collecting real error messages from all four drivers to test the sanitizer against

---

### Phase 4: Response Processing + File Management — S (~8%)

**Why it's the smallest phase:**
- Most directly portable from mcp-curl
- Response processor pipeline (size check → auto-save → truncate) follows the same pattern
- File saver, temp manager, and output dir validation are near-direct copies
- The only new work is SQL-specific formatting (column type metadata, DDL response shape, binary data base64 encoding, null handling)

---

### Phase 5: Extensible Layer + Transports — M (~12%)

**What makes it medium:**
- McpSqlServer builder class is complex (lifecycle management, config freezing, start rollback, utility caching) but has a detailed blueprint in mcp-curl's `McpCurlServer`
- Hook executor is a near-direct copy
- Both transports (stdio, HTTP) are domain-agnostic and copy directly

**Where the effort is:**
- Adapting the tool wrapper's config transforms for SQL (default profile resolution, guardrail merging)
- Wiring discovery tools through the hook system (decision already made, needs implementation)
- CLI entry point with `--config` argument parsing

---

### Phase 6: MCP Server Integration — M (~12%)

**What makes it medium:**
- Integration/wiring phase — connecting all previously built pieces
- 6 Zod schemas (straightforward)
- 5 tool handlers: `sql_execute` is the most complex (guardrail pipeline → execution → response processing); discovery tools and `query_file` are simpler
- Server factory, registration orchestration, and lifecycle management follow mcp-curl patterns
- Prompts and resources are lightweight

**Where the effort is:**
- `sql_execute` handler end-to-end: profile resolution → guardrail enforcement → rate limiting → query execution → response processing → error sanitisation
- Integration testing with mocked drivers to verify the full pipeline

---

### Phase 7: Polish + Documentation — L (~15%)

**Why it's larger than it looks:**
- Documentation (CLAUDE.md, README) is fast to write
- **Integration tests are the wild card** — Docker Compose setup for 4 database engines (MySQL 8.0, PostgreSQL 16, MariaDB 11, MSSQL 2022), writing end-to-end test suites, debugging driver-specific edge cases
- Edge case hardening (binary data, Unicode, nulls, very large cells) tends to surface unexpected driver behaviour

**Where the effort is:**
- Docker Compose environment that reliably spins up 4 databases
- Integration test suite covering: profile loading → connection → schema discovery → query execution → guardrail enforcement → error sanitisation — all against real databases
- CI pipeline configuration for running integration tests

---

## Calibration Guide

These are **relative estimates**, not calendar time. To convert to your team's units:

1. Pick the phase your team is most confident about estimating (Phase 1 or Phase 4 are good candidates — smallest and most predictable)
2. Estimate that phase in your team's units (days, story points, sprints)
3. Scale the other phases proportionally using the effort percentages above

**Example:** If your team estimates Phase 1 at 3 days for one developer:
- Phase 2: ~7.5 days (25% / 10% x 3)
- Phase 3: ~5.4 days
- Phase 4: ~2.4 days
- Phase 5: ~3.6 days
- Phase 6: ~3.6 days
- Phase 7: ~4.5 days
- **Total: ~30 days** (one developer)

This is illustrative only — actual velocity depends on team size, experience with these libraries, review processes, and how much time is spent referencing the mcp-curl source.

---

## Risk Factors That Could Increase Estimates

| Factor | Phases Affected | Impact |
|--------|:--------------:|--------|
| No prior experience with mysql2/pg/mssql APIs | 2 | Could double Phase 2 effort |
| Real database integration tests required (not optional) | 2, 7 | Adds Docker setup, CI config, and debugging time |
| Strict security review process | 3 | More test cases, formal review cycles |
| MSSQL driver complexity (Tedious API is less intuitive) | 2 | MSSQL driver alone could take as long as MySQL + Postgres combined |
| Cross-platform support required (Windows + macOS + Linux) | 4, 7 | File path handling, temp directory behaviour, permission differences |

## Opportunities to Reduce Scope

| Reduction | Phases Affected | Savings |
|-----------|:--------------:|---------|
| Ship with MySQL + PostgreSQL only, add MSSQL later | 2, 3, 7 | ~15-20% of total effort |
| Skip HTTP transport for v1 (stdio only) | 5 | ~3-5% of total effort |
| Skip integration tests, rely on unit tests with mocked drivers | 2, 7 | ~10-15% of total effort |
| Defer `query_file` tool (just auto-save, no paging) | 4, 6 | ~3-5% of total effort |
