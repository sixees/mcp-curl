---
status: pending
priority: p2
issue_id: 005
tags: [code-review, security, ssrf, defense-in-depth]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# SSRF blocklist misses IPv4-mapped IPv6 in compressed-hex form

## Problem Statement

WHATWG `new URL()` canonicalises IPv4-mapped IPv6 hosts to compressed hex:

- `http://[::ffff:127.0.0.1]/` → `parsed.hostname === "[::ffff:7f00:1]"`
- `http://[::ffff:10.0.0.1]/` → `parsed.hostname === "[::ffff:a00:1]"`
- `http://[::ffff:192.168.1.1]/` → `parsed.hostname === "[::ffff:c0a8:101]"`

`httpOnlyUrl()` correctly accepts these (schema-permissive is fine). But the SSRF blocklist regexes in `BLOCKED_HOSTNAME_PATTERNS_INTERNAL` and `BLOCKED_IP_PATTERNS_INTERNAL` only match the dotted-quad form (`::ffff:127.x.x.x`). They return `false` on the canonicalised hex form. The request is currently saved only because `dns/promises#lookup("[::ffff:7f00:1]")` returns `ENOTFOUND` (brackets confuse the resolver). If a future Node release, polyfill, or non-default lookup ever resolves the bracketed form (or if the code is refactored to strip brackets before `lookup()`), the bypass becomes live.

This is technically pre-existing, but PR #23 advertises *"schema and network layer agree"* as the rationale for the WHATWG migration. They don't agree on this case.

## Findings

- **File:** `src/lib/config/security/ssrf.ts:65-77, 147-152`
- **Reviewer (Security, S1):** verified by reproduction:
  ```
  "[::ffff:7f00:1]"  -> isBlockedHostname=false, isBlockedIp=false
  "[::ffff:a00:1]"   -> isBlockedHostname=false, isBlockedIp=false
  "[::ffff:c0a8:101]" -> isBlockedHostname=false, isBlockedIp=false
  ```

## Proposed Solutions

1. **Add compressed-hex regexes** — `/^\[?::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}\]?$/i`-style patterns to both `BLOCKED_HOSTNAME_PATTERNS_INTERNAL` and `BLOCKED_IP_PATTERNS_INTERNAL`. Add tests covering the compressed-hex variants of `127.*`, `10.*`, `192.168.*`. Effort: S.
2. **Normalise to dotted-quad before pattern-matching** — preferred long-term. Compute dotted-quad equivalent of any `::ffff:HHHH:HHHH` host before running the existing blocklist. Effort: M. Reusable for other IPv6/IPv4 corner cases.

Recommended: solution 2 (normalise once, pattern-match canonical form).

## Acceptance Criteria

- [ ] `validateUrlAndResolveDns` rejects `http://[::ffff:7f00:1]/` with the same error as `http://127.0.0.1/`
- [ ] Tests in `src/lib/security/ssrf.test.ts` cover compressed-hex variants for 127.*, 10.*, 192.168.*, 169.254.*, fc00:*
- [ ] Helper JSDoc on `httpOnlyUrl` softens the "schema agrees with network layer" framing — describe both layers as defense-in-depth, not invariant equivalence

## Resources

- `src/lib/config/security/ssrf.ts`
- `src/lib/security/ssrf.ts`
- `src/lib/security/ssrf.test.ts`
