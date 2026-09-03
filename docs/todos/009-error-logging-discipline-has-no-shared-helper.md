---
id: 009
title: "The redacted error-log line is hand-copied at six catch sites, with two disagreeing fallbacks"
status: open
severity: P2
tags: [code-review, dry, observability, pre-existing]
class-id: duplicated-logic
source: /simplify reuse lane (pattern-recognition-specialist), 2026-09-03
reviewers: [pattern-recognition-specialist]
created: 2026-09-03
---

# The error-logging discipline has no shared helper

## Problem

`docs/architecture/architecture.md` → *Error-Logging Discipline* requires logging
only `<label> error: [<context>] <ErrorClassName>`, never the message — because a
message can echo untrusted remote content. It is implemented by hand at every
catch site, and **the architecture doc already names this as a live gap**:
*"There is no central error-logging helper… this is a real coupling/cohesion gap,
not a future one."*

Because each site re-derives the non-`Error` fallback independently, two spellings
now coexist:

| Fallback | Sites |
|---|---|
| `"unknown"` | `session/session-manager.ts::closeWithTimeout`, `transports/http.ts` (POST handler), `transports/http.ts` (global error handler), `extensible/mcp-curl-server.ts::logShutdownError` |
| `"Error"` | `tools/jq-query.ts::executeJqQuery`, `tools/curl-execute.ts::executeCurlRequest` |

A third spelling, `"UnknownError"`, is what `security/wrap-error-logger.ts` uses.

## Evidence

`rg -n 'errorClass' src -g '!*.test.ts'` — 6 sites, all confirmed by reading:
`session-manager.ts:200`, `mcp-curl-server.ts:735`, `http.ts:388`, `http.ts:462`,
`jq-query.ts:167`, `curl-execute.ts:297`.

## Cost

A log-parsing rule — grep, SIEM, an alert — written against one spelling silently
misses the other. More importantly nothing *enforces* the "never the message"
half: a new catch site added by copying its nearest neighbour has even odds, and
there is no single call a reviewer can point at and say "you must use this."

## Why this is filed rather than fixed

It changes emitted log text at two of the six sites, which is observable
behaviour for anyone parsing these lines. Small, but it is a decision rather than
a cleanup, and `/simplify`'s remit stops short of it.

## Fix

Add the helper the architecture doc already proposes —
`logToolError(label, context, error)` in `src/lib/utils/error.ts`, beside the
existing `getErrorMessage` — and route all six sites through it. Pick one
fallback; `"UnknownError"` matches `wrap-error-logger.ts`, which is the newest
and the only one with a stated rationale.

## Acceptance criteria

- [ ] One helper; all six sites call it; `rg 'errorClass' src` returns only its
      definition.
- [ ] A unit test asserts the helper never includes `error.message` — the half of
      the discipline nothing currently enforces.
- [ ] One fallback spelling across the whole tree, `wrap-error-logger.ts` included.
- [ ] The architecture doc's "there is no central helper" paragraph is updated.
