# Work Handoff: fix-019-json-arm-detects-without-rewriting
**Date:** 2026-10-20 | **Branch:** fix/019-json-arm-detects-without-rewriting | **Plan:** none (todo 019) | **Status:** in-review

> Created by `/sixees-workflow:review` during `/sixees-workflow:work`'s Step 5, before the work
> run's own handoff sections were written. The work run is the author of the rest of this
> schema; this file currently holds the review record only.

## Code Review — 2026-10-20

**Certification:** complete
**Roster closure:** closed — unresolved: security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding."; pattern-recognition-specialist → "hand it to the reviewer who owns that lane"; pattern-recognition-specialist → "whichever reviewer owns that lane"

**Scope:** `cd006ba..HEAD` (base by `git merge-base --fork-point origin/HEAD HEAD`), commits `1cedbc0`, `01574b4`; 18 modified files.

**Agents used (8, all returned):** learnings-researcher (floor), code-simplicity-reviewer (floor), security-sentinel (floor), data-integrity-guardian (floor), typescript-reviewer, performance-oracle, architecture-strategist, pattern-recognition-specialist.

**Findings:** 7 classes — P1: 2 | P2: 4 | P3: 1. Filed: 7. Declined out of scope: 0. Investigate-first: 0. Rejected: 0. Three severities were raised one level because their `class-id` recurs in the ledger (021, 022, 025/026).

### Handoff assessment

No handoff existed at review time. The builder's in-session account (todo 019 audit, checkpoint) surfaced the BOM edge and the witness change as risks; it did **not** surface that removing the sanitise also blinded detection to invisible-character-split phrases (023), and its own BOM fix chose an instrument (`sanitised === response` short-circuit over `classifyBody`'s trim) that admits 16 Unicode spaces unparsed (021). Its prose sweep used too narrow a query (024).

### Key findings

| Severity | Category | Todo |
|---|---|---|
| P1 | data-integrity — usability shortcut passes Unicode space unparsed | 021 |
| P1 | data-integrity — BOM fallback sanitises the whole payload | 022 |
| P2 | security — detection reads only raw text on JSON arms | 023 |
| P2 | documentation — prose still says JSON is sanitised | 024 |
| P2 | testing — "wrap ran" witness set on fail-open | 025 |
| P2 | data-integrity — not-byte-identical notice incomplete | 026 |
| P3 | dead code — size-gate growth arms and alias | 027 |

### Verified claims

| Claim | Check | Result |
|---|---|---|
| Tests pass | `npm test -- --reporter=json` | 1357 passed, 0 failed, 7 skipped |
| P1 sweeps (021, 022) and 023 | out-of-tree vitest probe against `src/` | all three reproduced |
| `detectAndLog` not on a published entry | `package.json` exports → `src/lib.ts` | confirmed internal |

### Outstanding todos

| Todo | Priority | Status |
|---|---|---|
| 021 | P1 | pending |
| 022 | P1 | pending |
| 023 | P2 | pending |
| 024 | P2 | pending |
| 025 | P2 | pending |
| 026 | P2 | pending |
| 027 | P3 | pending |

**Open without a todo:** none.

**Blockers:** P1 021, P1 022.
