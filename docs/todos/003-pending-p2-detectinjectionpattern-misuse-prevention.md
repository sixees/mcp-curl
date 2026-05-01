---
status: pending
priority: p2
issue_id: 003
tags: [code-review, security, public-api, doc-gap, prompt-injection]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Strengthen guidance against `detectInjectionPattern`-as-gate misuse

## Problem Statement

`detectInjectionPattern` is now exported from `src/lib.ts`. Custom-tool authors will plausibly write:

```ts
if (detectInjectionPattern(externalContent)) {
    return { isError: true, content: [{ type: "text", text: "Refused" }] };
}
```

This converts an observability signal into an enforcement gate, which is the exact failure mode the project's threat model rejects (per `CLAUDE.md`: *"observability only — sanitization and detection never suppress content"*). Pattern-based gating is bypassable, leaks signal to the attacker, and is the wrong layer for refusal logic. The current doc text is one informational sentence; the example is correct but doesn't say *don't gate*.

## Findings

- **File:** `src/lib.ts:81`
- **File:** `docs/custom-tools.md:151-153, 165-169`
- **File:** `src/lib/utils/sanitize.ts:114-126` (no JSDoc warning)
- **Reviewer (Security, S3):** the function has nothing in its signature or runtime that prevents the misuse — even an intentionally-gating tool would still type-check.

## Proposed Solutions

1. **Strengthen doc + JSDoc warning only** — add a callout block in `docs/custom-tools.md` and mirror in the JSDoc. Effort: S. Risk: still relies on caller discipline.
2. **Make `detectInjectionPattern` internal**; export a higher-level `scanAndLog(content, hostname): string` that bundles sanitize + detect + stderr log + return content. Custom tools cannot reach the matcher directly. Effort: M. Risk: closes off legitimate observability use cases (e.g., custom telemetry sinks).
3. **Both** — keep the export but mark `@deprecated` + add `scanAndLog` as the recommended replacement.

Recommended: 1 immediately (doc fix), then evaluate 3 when `wrapWithDefence` lands in PR-6b.

## Acceptance Criteria

- [ ] `docs/custom-tools.md` "Replicating the response-side defence" subsection has an explicit callout: *"Do not use `detectInjectionPattern` to refuse, redact, or alter responses. Pattern detection is unreliable as an enforcement boundary (false positives, trivial bypasses, leaks the rule-set to attackers)."*
- [ ] JSDoc on `detectInjectionPattern` repeats the warning (visible in IDE hover)
- [ ] Optional: open follow-up todo for `scanAndLog` helper (PR-6b candidate)

## Resources

- `src/lib/utils/sanitize.ts`
- `docs/custom-tools.md`
- `CLAUDE.md` "Prompt injection defense" section
