---
status: pending
severity: low
effort: s
tags: [code-review, docs, post-processor, spotlighting, schema-generator, changelog, k-8]
dependencies: []
---

# Prose naming which error results get spotlighted disagrees with the code

## Problem Statement

The wrap now spotlights an `isError` result whenever it carries the remote-content mark, and `executeCurlRequest` marks every result it returns, whichever tool returns it: `curl_execute`, a YAML endpoint, or a custom tool passing an `executeRequest` result through unchanged. Several prose copies still say spotlighting never applies to an error result, or name `curl_execute` as the only exception.

## Findings

- class: prose copies of the "which error results are spotlighted" rule disagree with the code, which keys on the mark rather than on the tool.
- failure: a YAML endpoint with `enableSpotlighting: true` whose upstream stalls after the body (exit 28) returns its text inside sentinels, while `GeneratorConfig.enableSpotlighting` says "never on an error result". An embedder matching an error text from its start, as the docs describe, finds the sentinel line instead.
- instances:
  - `src/lib/schema/generator.ts::GeneratorConfig.enableSpotlighting` — "never on an error result" — confirmed, out of diff (its meaning changed with the diff)
  - `docs/custom-tools.md` → *Composing the Full Defence*, step 2 — "and the result is not an error" — confirmed, out of diff
  - `docs/configuration.md` → *enableSpotlighting*, step 3 — "only when this flag is `true` and the result is not an error" — confirmed, out of diff (raised by architecture-strategist as out-of-lane)
  - `CHANGELOG.md` → `[5.3.0]` *Changed*, "A failed request is still spotlighted" — "custom-tool errors are unchanged", wrong for a custom tool returning a failed `executeRequest` result as-is — confirmed, in diff
  - `docs/architecture/architecture.md` → the *afterResponse + spotlighting* and *Spotlighting (opt-in)* bullets — name only "a failed `curl_execute` request" — confirmed, in diff
- sweep: `rg -i 'spotlight.{0,60}error|error.{0,60}spotlight|skipped on error|not spotlighted|is not an error'` over src, docs, README and `.sixees`, excluding dist and the docs/work, docs/plans and docs/brainstorms trees — 9 prose candidates → 4 confirmed stale (pattern-recognition-specialist), plus `docs/configuration.md` from architecture-strategist. Reproduced: `rg -n -i 'not an error|never on an error' src/lib/schema/generator.ts docs/configuration.md docs/custom-tools.md` → 3 hits.
- root: source. The rule is "marked means spotlighted"; the mark is set per result in `executeCurlRequest`, so it covers every tool built on it, while the prose names one tool.
- Found by: pattern-recognition-specialist (architecture-strategist's out-of-lane note adds one instance), Surface 2 review of `fix/sync-quota-and-failed-exit`, 2026-10-30.

## Proposed Solutions

### Option 1: State the exception once by its real criterion, and cite it
In `docs/architecture/architecture.md` → *Spotlighting*: "a result carrying text the origin wrote: any failed `executeCurlRequest` result returned unchanged, including from YAML endpoints and `utilities().executeRequest`". The other sites cite that section rather than restating it.
- Effort: s. Risk: none.

### Option 2: Fix each copy in place
Reword each of the five sites.
- Cons: five copies of one rule stay live (K-8).
- Effort: s.

## Recommended Action

## Acceptance Criteria

- [ ] No tracked prose outside `docs/architecture/architecture.md` restates which error results are spotlighted without citing it.
- [ ] The `[5.3.0]` CHANGELOG bullet names the criterion, not one tool.
- [ ] Settle this after todo 028: inverting the mark there changes what this prose has to say.

## Work Log

### 2026-10-30 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** filed pattern-recognition-specialist's `stale-comment` (P3); added architecture-strategist's out-of-lane `docs/configuration.md` instance.
**Learnings:** a rule changed in code while its prose copies named the tool rather than the property.
