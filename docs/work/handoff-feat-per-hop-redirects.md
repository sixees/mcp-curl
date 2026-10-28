# Work Handoff: feat-per-hop-redirects

**Date:** 2026-10-28 | **Branch:** feat/per-hop-redirects | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** in-review
**Plan slice:** PR-3

This handoff was created during review, not by the work run's Step 6. `/sixees-workflow:work --pr-key=PR-3` ran this review at its Step 5. The work-handoff schema has not been written yet. The run stopped on the P1 escalation below, which waits for the operator.

## Code Review — 2026-10-28

**Certification:** complete
**Roster closure:** closed. Four destinations could not be resolved:
- data-integrity-guardian → "Anything else outside your lane gets one line under `notes:` and no finding"
- performance-oracle → "Anything genuinely outside your lane gets one line under `notes:` and no finding"
- security-sentinel → "Anything genuinely outside your lane gets one line under `notes:` and no finding"
- pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"

**Scope:** 831042a..HEAD, resolved with `git merge-base --fork-point origin/HEAD HEAD` (arm 1). It covers 3 commits and 15 files: 10 modified and 5 added.

**Agents used (8 of 8 returned):**

| Agent | Role | Envelope | Status | Classes | Note |
|---|---|---|---|---|---|
| security-sentinel | floor | v1 | findings | 1 | applied the range with git; both lenses named; fail-open-default hit on curlrc |
| code-simplicity-reviewer | floor | v1 | findings | 1 | no Bash; judged modified files whole (declared) |
| data-integrity-guardian | floor | v1 | clean | 0 | no Bash; judged files whole (declared); no datastore, so it judged the saved response file |
| learnings-researcher | floor | none | done | — | 5 known patterns: RC-35, RC-29, RC-56, RC-19, RC-17 |
| typescript-reviewer | optional | v1 | findings | 1 | no Bash; judged TS files whole (declared) |
| performance-oracle | optional | v1 | findings | 1 | applied the range; no project budget stated |
| architecture-strategist | optional | v1 | clean | 0 | no Bash; judged files whole (declared) |
| pattern-recognition-specialist | optional | v1 | findings | 1 | rg only, no jscpd |

**Finding counts:** 5 classes; none merged.
- By severity: P1 1 (raised from P2 by the ledger rule), P3 4.
- By disposition: 4 filed, 0 declined, 0 investigate-first. 1 is escalated and awaiting the operator.
- Rejected: 0.

**Merges:** none. performance, simplicity, security and pattern share the symbols `executeCurlRequest` and `gateHop`. Each of those symbols carries several distinct defects, so the classes were kept apart rather than collapsed into one.

**Escalations from the ledger (§4.1):**
- The `fail-open-default` curlrc class went from P2 to **P1**. It matches the `Class` of RC-56 (and also RC-19). **This is a recurrence.**

**Handoff assessment:** there was no builder handoff, so this assesses the commit bodies.
- They are accurate on the hop loop, the measurements and the teeth probes.
- One undisclosed gap is the P1. The builder's own doc-comment in `buildCurlArgs` claims "cURL never connects anywhere this pin does not cover". That is true of the argv but not of what cURL does: cURL still reads its config file.
- The commit body of 814961f discloses that the sticky cross-origin flag was removed after its probe failed nothing.

### Key findings

| Severity | Category | Todo |
|---|---|---|
| P1 | fail-open-default: cURL's config file (`.curlrc` `location`) re-enables redirect following inside one spawn, bypassing the per-hop gate (recurred: RC-56) | escalated, no todo |
| P3 | missing-validation: a redirect-hop DNS lookup runs outside the chain deadline | 024 |
| P3 | duplicated-logic: the per-hop gate sequence is written twice in `gateHop` | 025 |
| P3 | dead-code: the "origin did not parse" arm in the redirect loop is unreachable | 026 |
| P3 | convention-drift: the method table types `method` as `string` | 027 |

**The P1 in detail.** security-sentinel reported it, and I verified it.
- Instances:
  - `src/lib/execution/curl-args-builder.ts::buildCurlArgs`: no leading `-q`. Confirmed.
  - `src/lib/tools/curl-execute.ts::executeCurlRequest`: the loop's "one spawn is one hop" premise depends on that. Confirmed.
- Sweep: `rg -n 'curlrc|"-q"|--disable|CURL_HOME' src docs/architecture .sixees/ARCHITECTURE.md` returns 0 hits, reproduced.
- Measured on cURL 8.7.1 with `CURL_HOME`/`HOME` pointed at a temp dir whose `.curlrc` holds `location`:
  - Without `-q`, one spawn followed a loopback 302 and printed the target's body (`TARGET|200|`).
  - With `-q` first, it stopped at the 302 (`|302|<target>`).
- Fix proposed by the reviewer: put `-q` first in `buildCurlArgs`'s argv, add a unit test that pins `args[0]`, and add an e2e test with a curlrc that holds `location`.
- Why it escalates: before this branch the argv always carried `-L --max-redirs --proto-redir`, so a curlrc `location` added nothing. After it, the curlrc is the only thing that can turn following on, and when it does, the loop cannot see it.

### Verified claims

| Claim | Checked | Result |
|---|---|---|
| Full suite passes | `npx vitest run --reporter=json`, artefact parsed: 1714 total, 1707 passed, 0 failed, 7 pending, `success: true` | Holds. The structured artefact came from `npx vitest run` with a reporter flag, not from the declared `npm test` |
| `-L` gone from the builder | `rg -n '"-L"' src/lib/execution -g '!*.test.ts'` returns no hit | Holds for the argv. Does not hold for cURL's behaviour (P1) |
| Teeth on the hop host check, SSRF gate/pin, rate check and spent-deadline guard | Each probe mutated the source; each failed a named test; each was restored from a `cp` copy and `cmp`-verified | Holds |
| Each hop has its own `--resolve` and the parsed href | Mocked suite asserts the pins and spawn URLs per hop | Holds |
| The plan's RC-19 citation for "rate limit last" | Read RC-19 | Loose. RC-19 is about bounding the limiter maps and which limit fires first, not ordering for quota. The comment in `gateHop` inherits the plan's citation |

**Test verification:** a structured verdict exists, from the vitest JSON reporter (above). It was not taken through the declared `npm test` command.

### Outstanding todos (from this review)

| Todo | Priority | Status |
|---|---|---|
| 024 | P3 | pending |
| 025 | P3 | pending |
| 026 | P3 | pending |
| 027 | P3 | pending |

**Classes open without a todo:**
- `fail-open-default` (curlrc), P1. Escalated: `/sixees-workflow:work` escalates every P1 rather than filing it.

**Blockers:** the P1 curlrc class, which awaits the operator.

**Out-of-lane notes carried from reviewers (not findings):**
- A 307/308 to a cross-origin target keeps the body (data-integrity). This is the plan's M-7 and the same as Fetch.
- `insecure` is carried across a cross-origin hop (typescript, security). It is the model's own choice.
- Proxy env vars (`http_proxy`/`HTTPS_PROXY`/`ALL_PROXY`) are inherited by the spawn and bypass the `--resolve` pin on every hop (security). This is pre-existing and outside the diff. `-q` does not cover env vars.
- The chain-timeout error carries no `requestsSent` (data-integrity, architecture).
- Each followed hop takes a per-client rate-limit slot (performance). This is intended.
- `architecture.md` says "forwards only `Accept*`", but the allow-list is exactly Accept, Accept-Language, Accept-Encoding and User-Agent (architecture).
- The "Used by" list in `url-schemes.ts` omits `curl-execute.ts::redirectTarget` (architecture).
- `LOCAL_RATE_LIMITED`/`LOCAL_REFUSED_PATH` have no producer yet (simplicity, architecture). The plan wires them in PR-4.
- The `gateHop` comment's "(RC-19)" citation is loose (pattern). See Verified claims.
