# TODO: Evaluate prompt injection risk via auth_token / bearer token fields

## Problem

`McpCurlConfig.authToken` (and the corresponding `MCP_AUTH_TOKEN` env var) passes through
`sanitizeDescription()` filtering only when used as a tool description — not when used as
an Authorization header value. Printable ASCII characters (including `"`, `;`, newlines
after parsing, etc.) pass through unmodified.

The concern is narrow: if an attacker can control the value of `authToken` at server
startup time, they may be able to craft a value that manipulates the HTTP Authorization
header in unexpected ways. In practice, `authToken` is set at startup by a trusted
operator, so the attack surface is small.

## Decision Required

Evaluate whether:
1. `authToken` values should be validated (e.g. printable ASCII only, max length 256)?
2. Any other config fields that flow into HTTP headers need similar treatment?

This is a design-level question, not a straightforward code fix.

## Location

- `src/lib/types/public.ts` — `McpCurlConfig.authToken`
- `src/lib/transports/http.ts` — auth token usage

## Source

PR #20 code review (coderabbitai)
