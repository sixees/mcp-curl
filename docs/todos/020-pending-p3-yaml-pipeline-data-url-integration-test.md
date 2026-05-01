---
status: pending
priority: p3
issue_id: 020
tags: [code-review, tests, integration, defense-in-depth]
dependencies: [011]
source_pr: 23
review_date: 2026-05-01
---

# Integration test: `data:`/`javascript:` URL rejected through full YAML pipeline

## Problem Statement

PR-1 tests are unit-level: `httpOnlyUrl()` directly, `apiInfoSchema.baseUrl` directly, `CurlExecuteSchema.url` directly. The handoff acknowledges: *"No end-to-end test of a YAML schema endpoint rejecting a `data:` URL through the full HTTP transport. Unit coverage is sufficient given consumer schemas all delegate to `httpOnlyUrl`."*

For PR-6a (B9), this becomes load-bearing. PR-6a will attach a `.transform()` to `ApiSchemaValidator` that calls `sanitizeApiSchemaInPlace()`. The transform runs *after* the Zod parse — including after `httpOnlyUrl` runs. If the transform mutates `baseUrl` (it shouldn't, but defensive coding requires verifying), the URL invariant could silently break. Without an end-to-end test, a regression here surfaces only in production.

## Findings

- **Reviewer (Architecture, A8):** "PR-1 doesn't need to add this — flagging as a follow-up gate for PR-6a."
- **Handoff doc:** test gap acknowledged at line 71.

## Proposed Solutions

Add to PR-6a acceptance criteria:

```ts
// src/lib/api-server.test.ts (or schema/loader.test.ts)
it("rejects YAML schemas with a data: URL baseUrl", () => {
    const yaml = `apiVersion: "1.0"
api:
  name: evil
  title: Evil API
  description: payload
  version: 1.0
  baseUrl: "data:text/plain,evil"
endpoints:
  - id: foo
    path: /
    method: GET
    title: Foo
    description: Foo
`;
    expect(() => loadApiSchemaFromString(yaml)).toThrow(/scheme/i);
});
```

Plus the same test against the `validateApiSchema(rawObj)` direct path.

## Acceptance Criteria

- [ ] Integration test loads a YAML schema with `baseUrl: data:...` and asserts rejection
- [ ] Integration test exercises the `validateApiSchema(rawObj)` bypass path
- [ ] Test runs in PR-6a (referenced from that PR's acceptance criteria)

## Resources

- `src/lib/schema/loader.ts`
- `src/lib/schema/validator.ts`
- Plan section B9, Technical Review Correction S1

