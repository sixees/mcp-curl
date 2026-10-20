---
status: pending
severity: low
effort: s
tags: [code-review, dead-code, utils, url-resolution]
dependencies: []
---

# A security post-check sits behind earlier checks that already rule out every input it was meant to catch

## Problem Statement

In `src/lib/utils/url.ts::resolveRequestUrl`, the comparison
`new URL(joined).origin === base.origin` runs only after `new URL(baseUrl)` has
parsed and `isAllowedUrlScheme(base.protocol)` has passed. For an http(s) base that
parses, appending a path that starts with exactly one `/` cannot move the
authority, so the comparison cannot fail. The docblock credits it with catching
`"https://"` + `"/evil.com"` — but `new URL("https://")` throws first.

Nothing goes wrong at runtime; the cost is a reader believing a live guard exists
and a test (`"an empty authority"`) that claims to cover it.

**Builder acknowledged:** the work run's teeth probe found removing the comparison
left the suite green, and recorded it as "unproven defence-in-depth".

## Findings

- instances:
  - `src/lib/utils/url.ts::resolveRequestUrl` — the comparison, the `"https://"`
    docblock sentence, and the opaque-origin inline comment — confirmed
  - `src/lib/utils/url.test.ts::resolveRequestUrl` — case `"an empty authority"`,
    stopped by the parse, not the comparison — confirmed
- sweep: `rg -n '\.origin\s*===|origin ===|\.origin ==' src` → 1 candidate → 1 confirmed.
- Probe (run by the builder): replacing the condition with
  `isAllowedUrlScheme(base.protocol)` keeps `url.test.ts` green.
- Reviewer: code-simplicity-reviewer (P3, confidence medium).

## Proposed Solutions

### Option 1: remove the comparison

Drop `new URL(joined)` and the origin compare; keep the base parse + scheme check.
Rename the test case to "unparseable base". The plan's Item 1 line asking for the
assert then needs an operator decision (the plan text is not edited).
**Effort:** s · **Risk:** low — the executor's SSRF gate still checks the joined URL.

### Option 2: keep it as a declared backstop

Keep the code; rewrite the docblock to say it is a backstop with no known reaching
input, and move the `"https://"` example to the parse.
**Effort:** s · **Risk:** none

## Recommended Action

_Unfilled — needs the operator's call._

## Acceptance Criteria

- [ ] No comment or test name credits the comparison with an input the parse rejects
- [ ] If kept, the docblock says no known input reaches it

## Work Log

### 2026-10-20 - Filed by /sixees-workflow:review (Surface 2)

**By:** Claude Code
**Actions:** Dispositioned in scope (confirmed instance in diff `8edf9e7..HEAD`).
