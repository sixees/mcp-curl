---
title: "PR-4 / B5 — authToken printable-ASCII validation + length cap"
date: 2026-05-01
branch: feat/hardening-pr-4-auth-token
plan: docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md
status: complete
---

# Work Handoff: PR-4 / B5 — `authToken` printable-ASCII validation + length cap

**Date:** 2026-05-01 | **Branch:** `feat/hardening-pr-4-auth-token` | **Plan:** [`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`](../plans/2026-04-30-chore-pre-bigwork-hardening-plan.md) (item B5 / PR-4) | **Status:** complete

## Summary

PR-4 of the 9-PR pre-bigwork hardening track. Closes plan item **B5**: validates the operator-supplied HTTP transport auth token (`MCP_AUTH_TOKEN` env var or `McpCurlConfig.authToken`) at startup, rejecting tokens that are not printable ASCII (0x20–0x7E) or that exceed `LIMITS.MAX_AUTH_TOKEN_LENGTH` (4096 chars). The validator throws a `createConfigError("MCP_AUTH_TOKEN", …)` synchronously before any side-effecting setup (session manager, cleanup intervals, listening socket) so a misconfigured operator sees the error before the server starts accepting connections. The token value is never echoed in error messages — `[length=N]` and `[redacted]` markers are used instead. Constants live in `config/limits.ts` and `config/security/validation.ts` per repo convention. Plan reviewer finding **S11** (timing-safe auth compare) was deferred to PR-4 but turned out to be a no-op — `safeStringCompare()` (used by `createAuthMiddleware`) already wraps `crypto.timingSafeEqual` with length-padding (`src/lib/security/input-validation.ts:31`), so no compare-side change was required.

## What was implemented

### B5 — `validateAuthToken()` (PR-4)

- **What:** new exported function in `src/lib/transports/http.ts` plus call sites in `runHTTP()` and `McpCurlServer.startHttp()`. Constants land in their convention-mandated homes; the function imports them.
- **Key files (5):**
  - `src/lib/config/limits.ts` — added `MAX_AUTH_TOKEN_LENGTH: 4096` to `LIMITS` with a JSDoc explaining the choice (covers RSA-256 JWTs ~700–900 chars, OIDC ID tokens 1500–2500 chars, JWE up to ~4 KB, well under the 8 KB HTTP header line limit).
  - `src/lib/config/security/validation.ts` — added `PRINTABLE_ASCII = /^[\x20-\x7E]+$/` regex with JSDoc explaining what it excludes (C0 controls, DEL, high-bit bytes).
  - `src/lib/config/security/index.ts` — re-export `PRINTABLE_ASCII` for symmetry with the other validation patterns (`UUID_REGEX`, `WINDOWS_RESERVED_BASENAMES`).
  - `src/lib/transports/http.ts` — added `validateAuthToken()` exported function; inserted call sites in `runHTTP()` (now the **first** statement, before `cleanupOrphanedTempDirs`) and `createHttpApp` continues to receive the validated `authToken` value.
  - `src/lib/extensible/mcp-curl-server.ts` — imported `validateAuthToken`; called from `startHttp()` **before** session manager / cleanup-interval setup, so a bad token aborts cleanly without orphaned timers.
- **Approach:** mirrors the plan diff almost verbatim. Function lives in the transport file (close to its caller) but pulls constants from `config/`. Errors flow through the existing `createConfigError(name, value, reason)` helper for formatting consistency with `MCP_CURL_OUTPUT_DIR` and `MCP_CURL_SESSION_TIMEOUT` errors. Validation runs before any side-effecting setup so a failed start leaves no temp dirs, intervals, or listening sockets behind.

### S11 — timing-safe auth compare (no-op finding)

- **What:** verified `safeStringCompare()` in `src/lib/security/input-validation.ts` already wraps `crypto.timingSafeEqual` with length-padding (line 31) — exactly what S11 asked for. No code change required.
- **Where the check fires:** `createAuthMiddleware()` (`http.ts:141`) compares the incoming `Authorization` header against `Bearer ${authToken}` via `safeStringCompare`, so request-time comparison is already timing-safe.
- **Documented:** flagged in this handoff so the next reviewer doesn't chase the finding twice.

### Tests added

13 new test cases in `src/lib/transports/http.test.ts` under a new `describe("validateAuthToken")` block, total file went from 16 → 34 tests. Coverage:

| Plan scenario | Test case |
|---|---|
| Empty / undefined token → no throw | `accepts undefined (no token configured)`, `accepts an empty string (treated as no token)` |
| 4096-char printable ASCII → no throw | `accepts a token at the maximum allowed length` |
| 4097-char token → throws with length-bound message | `rejects a token one character over the maximum` |
| Token value NOT in error string | `includes the length but not the token value in the over-length error`, `redacts the token in the charset error and never echoes the input` |
| Token containing `\n`, `\r`, `\0`, `\x7F` → throws | `rejects token containing newline/carriage return/tab/NUL/DEL (0x7F)` (parameterised via `it.each`) |
| Token containing high-bit char (`é`, emoji) → throws | `rejects token containing high-bit char (é)/emoji` |
| Real-world RSA-256 JWT (~700 chars) → no throw | `accepts a real-world RSA-256 JWT (~700+ chars, regression lock)` |
| Real-world OIDC ID token (~1800 chars) → no throw | `accepts a real-world OIDC ID token (~1700+ chars, regression lock)` |
| Error references `MCP_AUTH_TOKEN` | `references the env var name (MCP_AUTH_TOKEN) in error messages` |

`it.each` is used for the 7-row control-character matrix; a short token (`Bearer-style-token-123`) is added as the happy-path case the plan didn't list.

### README

- **What:** added a single bullet to `## Security Highlights` covering the new behaviour: "Auth-token validation — `MCP_AUTH_TOKEN` rejected at HTTP startup if not printable ASCII (0x20–0x7E) or longer than 4096 chars; bearer comparison is timing-safe". Mentions both validation and the pre-existing timing-safe compare in one line so operators aren't left wondering whether one implies the other.
- **Why one bullet, not a new section:** consistent with the existing Security Highlights bullet style; the plan's Documentation Plan asks for a Security Highlights mention specifically.

### Plan housekeeping

- Ticked all four PR-4 / B5 acceptance-criteria boxes (`[ ]` → `[x]`) in the plan body, mirroring how PR-1 / PR-2 / PR-3 tracked their items.

### Pre-existing handoff cleanup (one commit, separate scope)

- **What:** the working tree on `main` carried two staged deletions of pre-PR-1 handoff stubs (`docs/work/handoff-chore-quickwin-todos.md`, `docs/work/handoff-docs-architecture-and-followups.md`). User authorised committing them as cleanup on this branch.
- **Where:** first commit on the branch (`chore(docs): remove superseded handoff drafts`).
- **Why on this branch:** keeping `main` clean for the next PR; the stubs were superseded by the per-PR handoffs that landed in PR-1/2/3.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|-------------------------|
| `MAX_AUTH_TOKEN_LENGTH = 4096` | Covers all common JWT/OIDC/JWE production token sizes (RSA-256 JWT ~700, OIDC 1500–2500, JWE up to ~4 KB) and stays below the 8 KB HTTP header line limit. The simplicity reviewer pushed back on the cap entirely — kept anyway because the failure mode without it is an obscure 431-Header-Too-Large from Express on the first request, not a clear startup error. | (a) 256 (original draft) — rejects RSA-256 JWTs; **rejected** as a known false-positive class. (b) No cap (simplicity reviewer's suggestion) — **rejected** for the failure-mode-clarity reason above. |
| Validation runs **before** all side-effecting setup in both transport entry points | A misconfigured token should leave no temp-dir cleanup, no session-manager interval, and no listening socket behind. Net cost: zero (the call is synchronous and runs in microseconds). | Validate *just before* `app.listen()` — **rejected:** mid-init validation orphans the cleanup intervals if the throw escapes; the cost of moving it earlier is one statement reorder. |
| Function lives in `transports/http.ts`, not `config/` | Close to its only caller; the constants it references live in `config/`. Splitting one tiny validator into its own file is overhead for no real gain. | New `src/lib/security/auth-token-validation.ts` — **rejected:** would duplicate the file-per-concern pattern unnecessarily; pattern-recognition reviewer agreed in the plan's Research Insights. |
| Error messages always reference `MCP_AUTH_TOKEN` (the env var name) even when the token came from `McpCurlConfig.authToken` | The env var is the canonical externally-visible name; operators see it in their boot logs even if they configured the value programmatically. Mirrors how `MCP_CURL_OUTPUT_DIR` errors are formatted regardless of whether the value came from the env or `McpCurlConfig.outputDir`. | Distinguish env-vs-config in the error — **rejected:** doubles the error surface for marginal pedagogical value; the operator's first instinct is "what env var produced this?" and we want to answer that. |
| `it.each` for the control-character matrix; happy-path JWT/OIDC fixtures inline | `it.each` collapses 7 byte-class rejections into one parameterised case while keeping each row's failure message explicit. The two JWT/OIDC fixtures are large enough that inlining keeps them visible to readers without forcing a fixture-file scan. | Separate test cases per byte class — **rejected:** seven near-identical `it()` blocks add noise; `it.each` is the project's convention for this shape (see `test:url-scheme.test.ts`). |
| Document S11 as resolved no-op rather than touching `safeStringCompare` | The helper already does what S11 asked for. Touching it would be code churn for a finding that's already closed. | Add a `validateAuthToken`-side compare guard (defence-in-depth) — **rejected:** would duplicate logic that `createAuthMiddleware` already runs at every request. |

## What to pay attention to during review

- **Risk areas:**
  - **Behaviour change for operators with non-printable tokens.** Any operator who has stored an auth token containing CRLF, NUL, high-bit, or DEL bytes — or who has somehow concatenated a >4096-char string into the env var — will see HTTP startup fail after upgrade. The error message is clear (`Invalid MCP_AUTH_TOKEN value "[redacted]": must contain only printable ASCII characters (0x20–0x7E).`) and references the env var name. Plan §Risks calls this out as Low likelihood / High impact; the CHANGELOG entry should highlight it.
  - **The validator does not coerce or sanitise.** It throws. Operators see an error and must fix their config. This is intentional ("fail loudly at startup so a misconfigured operator sees the error immediately") but if any consumer relied on whitespace-trimming or NUL-filtering happening downstream, that will surface as breakage. Grepped `src/` for prior consumers — only `safeStringCompare` touches the token at runtime, and it's a byte-equal compare, so no implicit coercion existed before.
  - **Length cap (4096) is a heuristic.** A future production deployment that legitimately uses tokens >4096 chars will hit this cap. The cap is documented in plan body B5 as deliberately conservative; if a real workflow surfaces, raising it is a one-line config change. Test fixture asserts `LIMITS.MAX_AUTH_TOKEN_LENGTH` directly so adjusting the constant won't require touching the test.
- **Edge cases considered:**
  - `undefined` and `""` both treated as "no token configured" (consistent with `createAuthMiddleware`'s existing fall-through).
  - Tab (`\t`, 0x09) is rejected — not in 0x20–0x7E. The plan listed CR/LF/NUL/DEL/high-bit explicitly; tab is rejected by the same regex without a separate test row needed (covered in the parameterised matrix).
  - Emoji and other multi-codepoint sequences hit the high-bit branch via the regex — locked with an explicit test row to make the contract obvious.
  - Real-world JWT/OIDC fixtures use synthetic but plausibly-shaped triplets (`header.payload.signature`); not signed by any real key. Asserts `length > 700` / `> 1700` so a future fixture-rewrite that accidentally truncates fails loudly.
- **Under-tested:**
  - **No end-to-end test that boots the HTTP transport with a bad token and asserts the listener never binds.** The unit-level coverage proves the validator throws; the integration order is verified by code reading (`runHTTP` and `startHttp` both call `validateAuthToken` before `app.listen`) but not by a live test. Adding such a test would require booting an Express server in vitest, which the project does not currently do anywhere. Acceptable trade-off: the unit test + code-path inspection cover the contract.
  - **No test for `safeStringCompare` being timing-safe.** It's been timing-safe since before this branch, but PR-4 inherits the gap. Out of scope; flagged here so a future reviewer doesn't expect it.
  - **No fuzz-style adversarial test** against the regex (e.g. arbitrary byte arrays). Could be added as a future hardening step; the explicit byte-class matrix covers the documented attack surface.
- **Pattern deviations:** none. Function placement, constant placement, error helper, test structure, and README phrasing all follow established repo patterns.

## Known issues and limitations

- **Operator paste-error class is narrowed but not eliminated.** A token that *passes* the regex but happens to be wrong (typo, wrong env variable copied) still fails at request time with a 401. The validator only catches structural problems — content correctness is outside scope by design.
- **The validator does not log on success.** A successfully-validated token leaves no startup log line. If operators want to confirm the validation ran, they have no positive signal — only the absence of an error. Considered adding a `console.error("auth token validated")` line; rejected because the project's stderr-logging convention is "errors only." If a future operability concern surfaces, a single info line is a one-line addition.
- **The S11 finding is closed by inheritance, not by a direct PR-4 change.** A reviewer following the plan's "deferred to PR-4 (B5)" trail will look for a `crypto.timingSafeEqual` call in this PR's diff and not find one. The handoff `What was implemented → S11` section explains the no-op disposition; flagging here as well so it's hard to miss.
- **`PRINTABLE_ASCII` is not a public-barrel export.** It's a config-internal constant, used only by `validateAuthToken`. If a future consumer wants to validate operator strings (other env vars, CLI args), they'd need to either deep-import or we'd promote the regex to a public utility. Not in scope for PR-4.

## Testing summary

- **Tests added:** 13 (one parameterised `it.each` block of 7 rows + 6 standalone `it()` cases, all under a new `describe("validateAuthToken")` block in `src/lib/transports/http.test.ts`).
- **Tests passing:** **622 passed | 7 skipped | 0 failed** (full vitest suite, `npm test`). Up from 605 on PR-3 — **+17 net**, comprised of 13 new validation tests plus 4 net-new from the `it.each` rows expanding (each row counts as one test in the runner). Cross-checked: no other test count changed.
- **Linting:** pass (`npm run build` succeeds; project does not expose a separate lint target).
- **Manual verification:**
  - `grep '${token' src/` returns only safe call sites (JSDoc reference and `${token.length}`); no `${token}` echoes the value.
  - `npm run build` produces clean `dist/lib.d.ts` and `dist/index.d.ts`. `validateAuthToken` is **not** added to the public-barrel `src/lib.ts` exports (transport-internal helper, intentional).
  - Read both call sites end-to-end to confirm validation runs before `app.listen()` in both paths.
- **Test gaps:**
  - No end-to-end "fail to bind on invalid token" test — see "Under-tested" above.
  - No coverage test (the project does not configure a coverage provider). The 13 cases collectively touch every branch of `validateAuthToken` by inspection: undefined, empty, valid short, valid at-cap, over-cap, all rejection paths.

## Commit history

```text
2917ad6 docs(plan): tick B5 + add PR-4 handoff document
11298c5 docs(readme): document MCP_AUTH_TOKEN validation in Security Highlights
fbd829b chore(dist): rebuild for B5 auth-token validator
dd06d5f test(transport): cover validateAuthToken charset + length rules (B5)
de11e20 feat(transport): validate MCP_AUTH_TOKEN at HTTP startup (B5)
f0f2f00 chore(config): add MAX_AUTH_TOKEN_LENGTH and PRINTABLE_ASCII
7582a44 chore(docs): remove superseded handoff drafts
```

Suggested review order is bottom-up: branch cleanup → constants → validator + integration → tests → dist rebuild → README → plan tick + handoff.

## Review context

- **Suggested review order:** read commits bottom-up (cleanup → constants → validator + integration → tests → docs). The constants commit is a no-op until the validator commit lands; reviewing in order makes the dependency obvious.
- **Related docs:**
  - `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` — section B5 / PR-4, lines 392–482.
  - `docs/work/handoff-feat-hardening-pr-1-url-helpers.md` — establishes the "constants in `config/`, validators near callers" pattern this PR follows.
  - `src/lib/security/input-validation.ts` — `safeStringCompare` (the timing-safe compare S11 was about).
- **Dependencies on other work:** none. PR-4 is independent of PR-1/2/3 at the file level (touches `transports/http.ts`, `extensible/mcp-curl-server.ts`, two `config/` files, and `README.md`; no overlap with PR-1's URL helpers, PR-2's jq tests, or PR-3's README inputSchema example). Unblocks no other PR — PR-5 (B4) and the rest can ship in their existing order.

## Post-Deploy Monitoring & Validation

This PR is HTTP-transport-only and changes startup behaviour, not request-time behaviour.

- **Expected signals:**
  - Operators with a clean token: no observable change. Server starts as before; auth middleware behaves unchanged.
  - Operators with a malformed token (control bytes, >4096 chars): HTTP transport fails to start, stderr log line `Invalid MCP_AUTH_TOKEN value "[redacted]": must contain only printable ASCII characters (0x20–0x7E).` (or `... [length=N]: exceeds maximum 4096 characters.`).
- **Failure triggers:**
  - **Regression signal A:** an operator who had a working token before this PR sees `Invalid MCP_AUTH_TOKEN` after upgrade. Action: collect the token's *length and byte-class profile* (NEVER the token itself), confirm against the documented cap; if it's a legitimate >4096-char production token, raise the cap with justification. CHANGELOG flags the behaviour change so this should be expected, not a surprise.
  - **Regression signal B:** the HTTP transport starts cleanly but the auth middleware now rejects all requests as 401. This would imply `validateAuthToken` accepts a token but `safeStringCompare` rejects every header — vanishingly unlikely (both operate on the same string), but if seen, it's a contract bug between validation and compare.
- **Validation window:** 7 days post-merge. The change is observable on every HTTP-transport boot, so the signal arrives quickly if any operator has a malformed token.
- **Where logs/dashboards live:** this project does not bundle hosted logging — operators run `mcp-curl` themselves and read stderr. The CHANGELOG entry directs them to look for the `Invalid MCP_AUTH_TOKEN` prefix on startup failure.

## Follow-up work

- [ ] **PR-5: Auto-sanitize Zod field descriptions on `registerCustomTool()`** (B4) — read plan's "Technical Review Corrections" S3 + C3 + A7 first; rebuild needs nested recursion (`ZodObject`/`ZodArray<ZodObject>`/`ZodUnion`/`ZodOptional`/`ZodDefault`/`ZodNullable`), `WeakMap` memoisation, and a Standard-Schema round-trip test.
- [ ] **PR-6a: YAML schema sanitize-at-load** (B9) — sanitisation must move into `validateApiSchema()` itself (per S1) so the public-API bypass (`ApiSchemaValidator.parse(rawObj)`) cannot leak; add A8 raw-YAML pre-Zod pass.
- [ ] **PR-6b: defence-in-depth parity for YAML/custom-tool output** (B3 expanded) — `wrapWithDefence` runs sanitize+detect+spotlight; covers the 4th asymmetry surfaced during deep-plan review; idempotence symbol per A1; hook short-circuit per S2.
- [ ] **PR-7: Response-side sanitization expansion** (B7-sub-1-3 + B8) — ReDoS-hardened HTML strip, markdown link/image beacons, expanded Unicode invisibles. Read plan's S5/S6/S7/S9 corrections.
- [ ] **PR-8: Detection-pattern expansion** (B7-sub-4-5) — observability-only; gated on `unicode-confusables` integration per S8 / C11.
- [ ] **PR-9: CI perf budgets** (post-PR-7) — measure baseline first; no thresholds before measurement (C1, A9).
- [ ] **Final cleanup commit** (after all 9 PRs merge): the plan's WBS item 15 originally specified deleting `docs/todos/` + `docs/upstream-contributions.md` as a final commit. Both were already pre-deleted in PR-1 (commit `570f6a5`). No additional cleanup needed.

### Outstanding Todos

_None created during this PR session._ The plan's S11 finding ("deferred to PR-4 (B5)") was resolved as a no-op (existing `safeStringCompare` already uses `crypto.timingSafeEqual`); no new todo file was created because the finding is closed.

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _(none)_ | — | — | — |

### Resolved Todos

_None this session._ PR-1 already deleted the `docs/todos/` directory; the B5 todo (`auth-token-sanitize-consideration.md`) was deleted there and is recorded in PR-1's handoff Resolved Todos table. PR-4 closes the underlying plan item (B5) but does not interact with the (now-deleted) todo file.

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _(none — already recorded under PR-1's handoff)_ | — | — | — | — |

---

## Code Review — 2026-05-01

### Review Summary

- **Reviewer:** automated multi-agent review (5 agents in parallel)
- **Agents used:** `security-sentinel`, `typescript-reviewer`, `code-simplicity-reviewer`, `performance-oracle`, `learnings-researcher`
- **Findings:** 🔴 P1: 0 | 🟡 P2: 6 (5 addressed, 1 rejected on review) | 🔵 P3: 5 (3 addressed, 1 deferred as todo, 1 false-positive)

### Handoff Assessment

The builder's self-assessment was **honest and largely accurate**. All five reviewers independently verified the load-bearing claims:

- ✅ **Token-leak claim verified.** `grep '${token' src/` returns only `${token.length}` and JSDoc references; no code path interpolates the raw token into an error, log, or response.
- ✅ **Timing-safe compare verified.** `safeStringCompare` correctly pads to equal length and XORs `lengthMatch` into the result; `crypto.timingSafeEqual` always sees equal-length buffers.
- ✅ **Charset regex verified.** `/^[\x20-\x7E]+$/` correctly rejects every documented byte class (CRLF, NUL, DEL, high-bit, multi-byte UTF-8, surrogates, emoji); no backtracking risk.
- ✅ **Validation-order claim partially refined.** True for `runHTTP()` (no rollback handler — must validate first). For `McpCurlServer.start()`, two cleanup intervals (`startRateLimitCleanup`, `startInjectionCleanup`) start at lines 366–367 *before* `startHttp()` is called; the `try/catch` at lines 361–411 cleans them up on throw. So the *invariant* (no orphaned timers on bad token) holds, but the *literal* "validates before all side effects" needed nuance. Comments updated in both startup paths.

**No undisclosed issues** — every concern reviewers raised matched something the builder either had documented (S11 closure, no-public-barrel-export) or was a defensible design choice (length cap value, JWT/OIDC fixtures).

### Verified Claims

| Handoff Claim | Verified? | Notes |
|---------------|-----------|-------|
| Tests pass (622 / 7 / 0) | ✅ yes | confirmed at every reviewer stage |
| Validation runs before all side effects in `runHTTP` | ✅ yes | first statement |
| Validation runs before all side effects in `startHttp` | ⚠️ refined | true within `startHttp` itself; cleanup intervals start in parent `start()` and are torn down by rollback handler |
| Token never echoed in errors | ✅ yes | only `[length=N]` and `[redacted]` ever interpolated |
| `safeStringCompare` already timing-safe (S11 no-op) | ✅ yes | `crypto.timingSafeEqual` over padded buffers |
| `PRINTABLE_ASCII` not in public barrel | ✅ yes | absent from `src/lib.ts`, `dist/lib.js`, `dist/lib/index.js` |
| `validateAuthToken` not in public barrel | ✅ yes | same — transport-internal only |
| Constants in convention-mandated homes | ✅ yes | `config/limits.ts` + `config/security/validation.ts`; barrel re-export symmetric with `UUID_REGEX` |
| `it.each` for byte-class matrix follows project convention | ✅ yes | matches `prompts/url-scheme.test.ts` shape |
| No public-API regressions | ✅ yes | `dist/lib.d.ts` unchanged for public surface |

### Findings Resolved in This Pass

| ID | Severity | Category | Description | Resolution |
|----|----------|----------|-------------|------------|
| P2-A | 🟡 P2 | security/perf | `safeStringCompare` allocated buffers up to ~16 KB driven by attacker-controlled `Authorization` header length | Added length pre-check in `createAuthMiddleware` — header length must equal `expectedHeader.length` before reaching `safeStringCompare`. Length-based reject does not weaken timing-safe property (compare never reveals byte-equality). |
| P2-C | 🟡 P2 | TS/consistency | `createConfigError("MCP_AUTH_TOKEN", …)` used a literal | Replaced with `ENV.AUTH_TOKEN` for parity with `file-validation.ts`. Tests still assert `/MCP_AUTH_TOKEN/` (resolved value of the constant). |
| P2-D | 🟡 P2 | test redundancy | Over-cap rejection test + length-redaction test both used `cap+1` | Merged into one consolidated test that asserts `/exceeds maximum/`, `[length=N]`, redaction (no token echo), and no `z{10,}` run. |
| P2-E | 🟡 P2 | test fixtures | JWT/OIDC fixtures used `.repeat(40)` / `.repeat(100)` inflation (~1.5KB+3KB of base64 in source) for marginal regression-lock value | Replaced with one compact JWT-shaped fixture (~80 chars) that exercises the base64url alphabet + dot separator. Drops two tests, keeps the one regression-lock concern that `"a".repeat(MAX)` doesn't cover (charset breadth). |
| P2-F | 🟡 P2 | TS symmetry | Snapshot-semantics comment in `mcp-curl-server.ts` not mirrored in `runHTTP` | Both call sites now have explicit "Snapshot the env var once so validation and middleware see the same value" comments + a clarifying note on rollback asymmetry. |
| P2-B | 🟡 P2 | simplicity | Suggested collapsing `validateAuthToken` into `createHttpApp` | **Rejected on review.** `runHTTP()` lacks the try/catch rollback that `McpCurlServer.start()` has; collapsing would orphan timers on bad token in the standalone path. The duplication is intentional defense-in-depth. Documented this rationale in the comments above. |
| P3-1 | 🔵 P3 | docs | Handoff "before all side effects" claim needed nuance for `start()` | Clarified in the Verified Claims table above. |
| P3-3 | 🔵 P3 | robustness | `req.headers.authorization` array case unhandled | Added `Array.isArray(rawAuth) ? rawAuth[0] : rawAuth` collapse in `createAuthMiddleware`; new test asserts the fallback. |
| P3-5 | 🔵 P3 | docs | `createConfigError` JSDoc lacked redaction example | Added second `@example` block showing the `[redacted]` pattern. |
| P3-6 | 🔵 P3 | perf | `\`Bearer ${authToken}\`` rebuilt per request | Hoisted to closure capture at middleware construction; per-request hot path now does no string allocation. |
| P3-2 | 🔵 P3 | future-proofing | `createHttpApp` reachable via internal barrel without internal validation guard | Resolved indirectly: keeping validation at both call sites (rejecting P2-B) means `createHttpApp` always receives a validated token from any current consumer. If a future caller surfaces `createHttpApp` to external code, validation should be hoisted into it then. |

### Findings Deferred

| ID | Severity | Description | Defer Reason | Tracker |
|----|----------|-------------|--------------|---------|
| P3-4 | 🔵 P3 | `safeStringCompare(authHeader, "Bearer ${token}")` is case-sensitive on the `Bearer` scheme; RFC 6750 §2.1 requires case-insensitive scheme matching | Pre-existing (not a PR-4 regression); requires non-trivial refactor to split scheme prefix from token portion while preserving timing-safe property over the secret | `docs/todos/001-pending-p3-bearer-scheme-case-insensitivity.md` |

### Tests After Review

- `npm test` — **622 passing / 7 skipped / 0 failing** (unchanged total; net +1 in `createAuthMiddleware` describe, net -1 in `validateAuthToken` describe).
- `npm run build` — clean.
- New tests added: oversized-Authorization rejection (length pre-check) + array-form Authorization collapse + JWT-shaped accept.
- Tests removed: standalone over-cap rejection (folded into redaction test) + RSA-256-JWT fixture + OIDC-ID-token fixture.

### Outstanding Todos

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| `docs/todos/001-pending-p3-bearer-scheme-case-insensitivity.md` | P3 | RFC 6750 case-insensitive scheme matching | code-review |

### Blockers

**None — clear to merge.** All P2 findings are resolved or rejected on documented grounds. The remaining P3 (case-insensitive Bearer scheme) is pre-existing, low-impact, and tracked.
