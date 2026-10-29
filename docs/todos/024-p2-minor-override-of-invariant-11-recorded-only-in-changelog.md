---
status: pending
effort: s
tags: [code-review, architecture, versioning, release, invariants, changelog, standards]
dependencies: []
---

# A release contradicts a standing invariant by operator decision, and the decision is recorded only in the release notes

## Problem Statement

5.2.0 ships seven `**BREAKING:**` changes as a MINOR, by operator decision. `.sixees/ARCHITECTURE.md` → invariant 11 still says, without exception, that a breaking change to an entry point is a MAJOR. `.sixees/CONVENTIONS.md` → *Commits* treats the version, the `!` marker and the changelog as three severity claims that must agree. A `jq_filter` comment in `src/lib/server/schemas.ts` still justifies a design choice by invariant 11's MAJOR price.

A reader of invariant 11 either re-opens 5.2.0 as a P1 `broken-contract`, which re-litigates a settled decision, or cites invariant 11 to decline a future change the project would in practice ship as a MINOR. Two rules that both look authoritative are live (K-8).

**Builder's note:** the work run staged an RC for exactly this ("Invariant 11 reads as absolute, and a single-consumer release overrides it by operator decision", `docs/work/RC/invariant-11-single-consumer-minor.md`), approved by the operator on 2026-10-29. It is unnumbered until `/sixees-workflow:file-lessons --flush` runs. The reviewer could not see the staged directory. Flushing it and citing it from the places below may be the whole fix.

## Findings

- class: a release contradicts a standing invariant by operator decision; the decision is recorded only in the release notes, while the invariant, the convention that depends on it and a code comment that cites it still state the original rule.
- failure: the next reviewer reads invariant 11 and files 5.2.0's breaking bullets as a P1, or declines a future fix because "invariant 11 prices it as a MAJOR", while the project's practice is MINOR for a single directly-notified consumer. Any `^5.x` range resolves to 5.2.0 on install.
- instances:
  - `CHANGELOG.md` → `[5.2.0]` *Notes*, "Shipped in a MINOR release by decision" — confirmed, in diff
  - `package.json::version`, `"5.2.0"` beside seven BREAKING entries — confirmed, in diff
  - `.sixees/ARCHITECTURE.md` → *Invariants* item 11, unchanged — confirmed, out of diff
  - `.sixees/CONVENTIONS.md` → *Commits*, the `!`/version/changelog agreement rule — confirmed, out of diff
  - `src/lib/server/schemas.ts::CurlExecuteSchema`, the `jq_filter` comment "which invariant 11 prices as a MAJOR" — confirmed, file in diff
- sweep: `invariant 11|MAJOR` over `.sixees/`, `src/` and the published docs: 6 candidates, 4 confirmed. The CHANGELOG and `package.json` instances come from reading the release slice. `LESSONS.md` holds no RC for the 5.2.0 decision; `MINOR|6\.0\.0` finds only RC-36.
- root: source. The operator's decision never reached the document that owns the rule.
- Found by: architecture-strategist, Surface 2 review, 2026-10-29. Related prior art: RC-36, and todo 023 (operator declined the same record for 5.1.0 on 2026-10-26).

## Proposed Solutions

### Option 1: Flush the staged RC and cite it
Run `/sixees-workflow:file-lessons --flush`, then cite the issued RC id from the CHANGELOG `[5.2.0]` *Notes* bullet. Leave invariant 11's wording alone.
- Pros: the decision is recorded where `learnings-researcher` finds it, and invariant 11 keeps its default.
- Cons: invariant 11 still reads as absolute to someone who never searches the ledger.
- Effort: s. Risk: low.

### Option 2: Amend invariant 11 with its exception
Add the policy and its trigger to invariant 11, for example "a MAJOR, unless the operator ships it as a MINOR for a known, directly notified consumer set; the CHANGELOG *Notes* must then say so". Re-check the `schemas.ts` `jq_filter` comment against the amended text.
- Pros: one place states the real rule.
- Cons: touches a standards document in a release PR; it reverses the 2026-10-26 operator choice to leave invariant 11 unchanged.
- Effort: s. Risk: low.

### Option 3: Both
- Effort: s.

## Recommended Action

_To be decided at triage._

## Acceptance Criteria

- [ ] A grep for invariant 11's text returns a statement consistent with the 5.2.0 CHANGELOG note, or one that cites the RC.
- [ ] The `schemas.ts` `jq_filter` comment's justification still holds, or is reworded.

## Work Log

### 2026-10-29 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** merged architecture-strategist's `convention-drift` class (P2, in scope via `CHANGELOG.md` and `package.json::version`). No escalation: its slug matches no `Class` in the learnings digest.
**Learnings:** the staged RC answers the reviewer's second fix option once flushed.
