---
status: pending
priority: p2
issue_id: 004
tags: [code-review, security, tests, regression]
dependencies: [010]
source_pr: 23
review_date: 2026-05-01
---

# Add `vbscript:` + WHATWG-quirk regression tests at helper and consumer levels

## Problem Statement

`httpOnlyUrl()` correctly rejects `vbscript:` (WHATWG returns `protocol === "vbscript:"`), but coverage gaps exist:

1. `vbscript:` has zero coverage anywhere in `src/` (`grep "vbscript"` returns no matches). It's the historical companion to `javascript:` (still recognised by IE-mode browsers, some PDF readers, content viewers an LLM might render through). The PR added a per-consumer regression test for `data:` — `vbscript:` deserves the same treatment.
2. The helper test file misses *behaviour locks* for: leading-whitespace inputs (`"\thttp://example.com"` — WHATWG strips), mixed-case scheme normalisation (`"HTTP://example.com"`). Both behave correctly today but a future Node / Zod upgrade could change them silently.

## Findings

- **File:** `src/lib/utils/url.test.ts:105-145`
- **File:** `src/lib/prompts/api-discovery.test.ts:20-26`
- **File:** `src/lib/prompts/api-test.test.ts:20-26`
- **Reviewer (Security, S2):** asked for `vbscript:` per-consumer parity; flagged WHATWG behaviour lock-in.

## Proposed Solutions

Add tests:

```ts
// url.test.ts
it("rejects vbscript:", () => {
    expect(schema.safeParse("vbscript:alert(1)").success).toBe(false);
});
it("strips leading whitespace before scheme check (WHATWG behaviour)", () => {
    expect(schema.safeParse("\thttp://example.com").success).toBe(true);
});
it("normalises scheme case", () => {
    expect(schema.safeParse("HTTP://example.com").success).toBe(true);
});

// api-discovery.test.ts + api-test.test.ts
it("rejects vbscript: URLs", () => {
    expect(<schema>.safeParse("vbscript:alert(1)").success).toBe(false);
});
```

Tradeoff with finding #010: if we collapse the duplicate prompt tests via `it.each`, both consumers gain `vbscript:` for free. Sequence as: do #010 first, then add `vbscript:` to the parameterised test data.

## Acceptance Criteria

- [ ] `vbscript:` rejection asserted at the helper level (`url.test.ts`)
- [ ] `vbscript:` rejection asserted at both prompt schemas (or once via parameterised test if #010 lands first)
- [ ] WHATWG quirk locks in place: leading whitespace accepted, mixed case accepted

## Resources

- `src/lib/utils/url.test.ts`
- `src/lib/prompts/api-discovery.test.ts`
- `src/lib/prompts/api-test.test.ts`
