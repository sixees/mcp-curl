---
status: complete
priority: p3
issue_id: 018
tags: [code-review, plan, process]
dependencies: []
source_pr: 23
review_date: 2026-05-01
---

# Fold "Technical Review Corrections" back into plan body before PR-6b begins

## Problem Statement

`docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` has 36 "Technical Review Corrections" listed near the top (lines 35-105) that are authoritative on conflicts with the body. Body sections (B3, B4, B9) carry inline `⚠️ See Technical Review Corrections — A1, A2, A3, A6, S2, S4 supersede parts of this section` callouts.

This works for a single review pass but creates problems for downstream PRs:

- An implementer reading B3 has to read both the body AND scan the corrections section for matching IDs — implementing the union of both.
- The corrections cross-reference (A1+A2+A3+A6+S2+S4) creates a 6-place graph. PR-6b's implementer must join 7 sections before writing a line of code.
- If PR-5 surfaces new findings during implementation, where do they go? The corrections section grows; the body lags.

## Findings

- **File:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`
- **Reviewer (Architecture, A6):** "PR-6b's complexity is exactly the case where reviewer-fatigue from cross-referencing is most dangerous."

## Proposed Solutions

1. **Before PR-6b begins**, fold the corrections back into the body sections — overwrite the body diff sketches with corrected diff sketches, retire the corrections-section subsection, keep a one-line "Revised 2026-05-01 per technical-review pass" stamp at the top of each affected body section. Effort: M.
2. **Status quo** — accept the cross-reference burden. Risk: PR-6b implementer reads only the body and misses corrections.

Recommended: 1. Treat corrections as a one-shot review artifact, not a parallel section.

## Acceptance Criteria

- [ ] Body sections B3, B4, B9 (and any others affected) are rewritten to incorporate the corrections directly
- [ ] "Technical Review Corrections" section is retired or archived under a "Review history" appendix
- [ ] Each affected body section has a "Revised YYYY-MM-DD" stamp
- [ ] PR-6b implementer can read a single body section and have full context

## Resources

- `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (sections B3, B4, B9 + "Technical Review Corrections")
