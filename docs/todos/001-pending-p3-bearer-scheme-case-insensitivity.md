---
status: pending
priority: P3
issue_id: bearer-scheme-case-insensitivity
tags: [code-review, security, http-transport, rfc-compliance]
dependencies: []
---

# Bearer scheme case-insensitivity (RFC 6750 §2.1)

## Problem Statement

`createAuthMiddleware` in `src/lib/transports/http.ts` compares the incoming
`Authorization` header against `Bearer ${token}` **case-sensitively** via
`safeStringCompare`. RFC 6750 §2.1 states the auth scheme name (`Bearer`)
should be matched case-insensitively. A spec-compliant client sending
`bearer X` or `BEARER X` is rejected with 401.

This was surfaced during the PR-4 code review (typescript-reviewer P3-3) but
deferred because:
- It's a **pre-existing** behaviour, not introduced by PR-4.
- The fix requires re-shaping the compare into "verify scheme prefix
  case-insensitively (variable-time, non-secret), then timing-safe-compare
  the token portion." That's a non-trivial change to a security-critical path.

## Findings

- **Location:** `src/lib/transports/http.ts:178-189` (post PR-4 / B5 changes).
- **Evidence:** `expectedHeader = \`Bearer ${authToken}\`` is built once;
  `safeStringCompare(authHeader, expectedHeader)` compares the entire string
  byte-for-byte. Case differences in the scheme name → mismatch.
- **Impact:** Realistic clients almost always send `Bearer X` exactly, so the
  observable user impact is low. But strict RFC compliance is broken, and a
  future client written against the spec would fail.

## Proposed Solutions

### Option A — Split scheme prefix from token (recommended)

```typescript
const SCHEME_PREFIX = "Bearer ";
const expectedToken = authToken;
const expectedTokenBuf = Buffer.from(expectedToken, "utf8");
// per-request:
if (!authHeader || authHeader.length !== SCHEME_PREFIX.length + expectedToken.length) reject;
if (authHeader.slice(0, SCHEME_PREFIX.length).toLowerCase() !== "bearer ") reject;
const tokenPart = authHeader.slice(SCHEME_PREFIX.length);
if (!safeStringCompare(tokenPart, expectedToken)) reject;
```

- **Pros:** RFC-compliant; preserves timing-safe property over the secret
  portion (the token); scheme comparison is non-secret so variable-time is
  fine.
- **Cons:** More logic on the hot path; needs updated tests.
- **Effort:** Small (~15 LOC + ~3 tests).
- **Risk:** Low — the timing-safe boundary is unchanged for the secret.

### Option B — Match `^Bearer\s+` regex case-insensitively

Use a small anchored regex (`/^bearer\s+/i`) to strip the prefix, then
timing-safe compare the rest.

- **Pros:** Tolerates stray whitespace too.
- **Cons:** Slightly more permissive than RFC strictly requires (RFC says one
  space); regex on every request is more expensive than slice.
- **Effort:** Small.
- **Risk:** Low.

### Option C — Defer indefinitely

- **Pros:** No code change; current behaviour matches what real clients send.
- **Cons:** Spec violation persists; future-RFC-aware clients will fail.

## Acceptance Criteria

- [ ] `Authorization: bearer <token>` (lowercase scheme) is accepted when token matches.
- [ ] `Authorization: BEARER <token>` (uppercase scheme) is accepted when token matches.
- [ ] `Authorization: bearer <wrong>` is rejected (token mismatch).
- [ ] Timing-safe property over the **token portion** is preserved.
- [ ] No regression in existing 4 createAuthMiddleware tests.

## Work Log

(empty — pending)

## Resources

- RFC 6750 §2.1: <https://www.rfc-editor.org/rfc/rfc6750#section-2.1>
- PR-4 review: `docs/work/handoff-feat-hardening-pr-4-auth-token.md` (Code Review section)
- Implementation: `src/lib/transports/http.ts` `createAuthMiddleware`
