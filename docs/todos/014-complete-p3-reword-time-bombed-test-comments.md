---
status: complete
priority: p3
issue_id: 014
tags: [code-review, documentation, tests]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Reword `.split(":")[0]`-referencing comments in `url.test.ts`

## Problem Statement

Three comments in `src/lib/utils/url.test.ts` explain why specific test cases exist by *referring to the deleted implementation*:

- L97-100: "Regression guard: the previous .split(\":\")[0] form parsed this as the scheme \"https\" and host \"[\"…"
- L122-126: "The previous .split(\":\")[0] form would have classified the scheme as \"httpx\" and rejected; the parser-based form classifies as \"httpx:\" and rejects too."
- L139-144: "The WHATWG parser will throw or return a strange protocol on this input; the .split(\":\")[0] form would silently classify scheme as \"https\" and pass."

Future readers without git-archaeology context will read "the previous `.split(':')[0]` form would have…" and have no idea what that refers to. Time-bombed documentation. The handoff doc explicitly defends keeping them; the simplicity reviewer disagrees.

## Findings

- **File:** `src/lib/utils/url.test.ts:97-100, 122-126, 139-144`
- **Reviewer (Simplicity, C4):** "Reword comments to express what's being tested, not what the deleted code did."

## Proposed Solutions

Reword each comment to describe *what the test asserts*, not what the deleted code did:

```ts
// L97-100
// IPv6 hosts contain colons in the host portion; ensure protocol detection
// isn't fooled by the embedded colons.

// L122-126
// Look-alike scheme — must reject anything not exactly http: or https:.

// L139-144
// Malformed URL with double colon — confirms parser-based rejection;
// no string-split shortcut classifies scheme as "https".
```

## Acceptance Criteria

- [ ] All three comments rewritten in behaviour-describing form
- [ ] No remaining mentions of `.split(":")[0]` in test files
- [ ] Tests still pass

## Resources

- `src/lib/utils/url.test.ts`
