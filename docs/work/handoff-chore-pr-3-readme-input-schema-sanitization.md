---
title: "PR-3 / B2 — README example for sanitizing inputSchema field descriptions"
date: 2026-05-01
branch: chore/pr-3-readme-input-schema-sanitization
plan: docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md
status: complete
---

# Work Handoff: PR-3 / B2 — README inputSchema sanitisation example

**Date:** 2026-05-01 | **Branch:** `chore/pr-3-readme-input-schema-sanitization` | **Plan:** [`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`](../plans/2026-04-30-chore-pre-bigwork-hardening-plan.md) (item B2 / PR-3) | **Status:** complete

## Summary

Adds a short README subsection showing the `sanitizeDescription()` pattern for externally-sourced
`inputSchema` field descriptions in `registerCustomTool()`, and cross-links to the full discussion
in `docs/custom-tools.md#validating-external-inputs`. Pure documentation change — no source code,
tests, or public API touched.

## What was implemented

### B2 — README example (PR-3)

- **What:** Inserted an `### Sanitising externally-sourced field descriptions` H3 at the end of the existing `## Programmatic API` section in `README.md`, immediately above `## YAML Schema`. The example uses the exact diff snippet from the plan body (line 352–381).
- **Key files:**
  - `README.md` — added 30 lines (lines 150–179), no other content modified.
  - `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` — checked off both B2 acceptance-criteria boxes (`[ ]` → `[x]`).
- **Approach:** Followed the literal "Append" instruction in the plan's diff sketch. Per the brief
  Phase 1 placement question, chose Option 1 (inline H3 under "Programmatic API") over Option 2
  (new H2 "Custom Tools") because it's the smaller diff, matches the plan's `Append` verb literally,
  and the README's Documentation table already routes readers to `docs/custom-tools.md` for depth.

### Cross-link verification

- The plan's anchor target `docs/custom-tools.md#validating-external-inputs` corresponds to the existing
  `## Validating External Inputs` H2 in that file (line 88) — GFM auto-anchor matches.
- Symbols referenced in the example (`McpCurlServer`, `sanitizeDescription`) are confirmed publicly
  exported from `src/lib.ts` (lines 28 and 100). The example's import works against the published API.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Place the H3 under existing `## Programmatic API` rather than introducing a new `## Custom Tools` H2 | Smallest diff; matches the plan's `Append` instruction; the Documentation table already routes deep-dive readers to `docs/custom-tools.md`. | New `## Custom Tools` H2 with brief intro + the H3 — rejected because it expands README scope beyond what the plan requested, and the README already defers depth to `docs/custom-tools.md`. |
| Use the plan's example verbatim (`q` + `limit` field names, `fetchFieldDescriptionsFromDb()` placeholder) | Plan body carries the canonical wording; reproducing it as-is keeps the plan and README in sync and avoids reviewer churn over wording variants. | Custom example with different field names — adds drift risk without pedagogical gain. |
| Tick the B2 acceptance-criteria boxes in the plan file in the same commit | Keeps the plan ledger honest with actual ship state; mirrors how PR-1 / PR-2 (commits 571b9c4 / 7b7add1) were tracked. | Defer the tick to a separate plan-update commit — adds churn for no benefit. |

## What to pay attention to during review

- **Risk areas:** None. Pure documentation change to a README subsection that did not previously exist.
- **Edge cases considered but possibly uncovered:**
  - The example imports `sanitizeDescription` from `mcp-curl` — confirmed exported from `src/lib.ts:100`. If a future PR removes that export, this example breaks; today it does not.
  - The cross-link uses GFM anchor `#validating-external-inputs`. GitHub renders this correctly today; if the heading in `docs/custom-tools.md` is ever renamed, the README link will dangle. Low-risk because the heading is stable.
- **Under-tested:** Documentation changes have no automated test gate. Validated manually:
  - `npm test` → 605/612 pass (7 pre-existing skips, unchanged) — confirms no source-code drift.
  - Visual inspection of rendered Markdown in the diff.
- **Pattern deviations:** None. Matches the existing README voice (sentence-case headings, `mcp-curl` package prefix, fenced TypeScript blocks).

## Known issues and limitations

- **Plan note about B4 superseding B2 carried forward.** The plan body (line 383) explicitly notes
  this README block "becomes redundant once **B4** lands (auto-sanitisation of Zod field descriptions
  in `registerCustomTool()`)". The plan elects to keep B2 anyway, reframing it as the recommended
  pattern for "callers building Zod schemas dynamically before registration." This README addition
  follows that decision — when PR-5 (B4) lands, a follow-up may want to soften the wording from
  "It does **not** reach into `inputSchema`" to language consistent with B4's new auto-sanitisation
  semantics. Out of scope for PR-3.
- **No `### Custom Tools` H2 added.** The plan's "Why" sentence asserts the README "has a custom-tool section but no example" — but the README in fact has no such section. Resolved per user choice for Option 1 (single H3 inline under Programmatic API). If a future plan wants a top-level H2 for Custom Tools, it can absorb this H3.

## Testing summary

- **Tests added:** None (acceptance criteria are documentation-only — see plan lines 387–388).
- **Existing tests:** `npm test` → 605 passed, 7 skipped (pre-existing), 0 new failures.
- **Linting:** Project has no Markdown linter configured; visual review only.
- **Build:** Not run (no TypeScript or runtime code changed; build would be a no-op for this PR).
- **Manual verification:** Re-read the rendered Markdown sub-tree from line 145 to line 180; confirmed
  fenced block formatting, blank-line spacing around headings, and link target syntax.
- **Test gaps:** No automated check that the cross-link anchor resolves on GitHub. Acceptable — README links of this kind are not gated by CI in this repo today.

## Commit history

```text
git log --oneline main..HEAD
# (commit added below in Phase 5)
```

## Review context

- **Suggested review order:** README diff first (the substantive change); plan-file diff second (just two checkbox flips).
- **Related context:** This is the third PR landing the consolidated hardening plan. Prior PRs (in landing order):
  - PR-1 (commit `571b9c4`) — URL helper hardening + public-barrel symmetry (A1, A2, A3, A4, B6).
  - PR-2 (commit `7b7add1`) — `executeJqQuery` unit tests (B1).
  - PR-3 (this branch) — README inputSchema sanitisation example (B2).
- **Dependencies on other work:** None — fully independent docs change. Does not block or unblock any other PR in the plan.
- **Forward dependency:** When PR-5 (B4 — auto-sanitisation in `registerCustomTool()`) lands, that PR's author should soften this README block's wording from "required" to "defensive belt-and-braces." Plan §B4 line 383 already records that follow-up.

## Follow-up work

- [ ] (Tracked in plan) When PR-5 / B4 lands, soften the README wording added here to reflect that
      `inputSchema` auto-sanitisation now applies — see plan body line 383.

### Outstanding Todos

<!-- No new docs/todos/ files created this session. -->

| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _(none)_ | — | — | — |

### Resolved Todos

<!-- No docs/todos/ files were resolved or deleted this session — B2 originated from the plan, not a docs/todos/ file. -->

| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _(none)_ | — | — | — | — |

## Post-Deploy Monitoring & Validation

No runtime or operational impact. Documentation-only change.

- **Log queries / metrics / dashboards:** N/A.
- **Expected signals:** None.
- **Failure triggers:** None (documentation cannot fail at runtime).
- **Validation window:** Visual confirmation that the rendered README on `main` after merge displays
  the new H3 and that the cross-link to `docs/custom-tools.md#validating-external-inputs` resolves
  on GitHub. One-time check, no recurring monitoring needed.
