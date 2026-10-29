# Work Handoff: feat-per-hop-redirects

**Date:** 2026-10-28 | **Branch:** feat/per-hop-redirects | **Plan:** docs/plans/2026-10-27-feat-host-policy-redirect-hops-plan.md | **Status:** complete — awaiting push authorisation
**Plan slice:** PR-3

This handoff was created during review, not by the work run's Step 6. `/sixees-workflow:work --pr-key=PR-3` ran this review at its Step 5. The work-handoff schema has not been written yet. The run stopped on the P1 escalation below, which waits for the operator. *(Since resolved: the operator chose to fix it here, and the work-handoff schema now follows the review record.)*

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
- Why it escalates: before this branch the argv carried `-L --max-redirs --proto-redir` whenever `follow_redirects` was not `false`, so on that path a curlrc `location` added nothing (with `follow_redirects: false` it could already turn following on, unseen). After it, the curlrc is the only thing that can turn following on, on every request, and when it does, the loop cannot see it.

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

## Escalation resolved — 2026-10-28

The operator chose to grow this change and fix the P1 here ("100% please fix it here"). They also asked for todo 007 to be deleted.

| Class | Disposition | Commit |
|---|---|---|
| `fail-open-default` (curlrc), P1 | **Fixed.** `buildCurlArgs` now emits `-q` as its first argument, so cURL reads no config file. A unit test pins `args[0] === "-q"`. An e2e test points `CURL_HOME` at a `.curlrc` holding `location`; a loopback 302 to a `127.0.0.1` literal is refused with `LOCAL_REDIRECT_REFUSED`, and the target receives no request. Teeth: removing `-q` fails both tests, and the e2e test returns the target's body. Source restored and `cmp`-verified. `architecture.md` names `-q`. | see below |

Todo 007 has been deleted with `git rm`, at the operator's request. Its acceptance criteria are met by `curl-execute.redirects.e2e.test.ts`.

**Not re-reviewed:** this fix was made after the Surface-2 review above (K-16).

---

# Work Handoff: feat-per-hop-redirects

## Summary

mcp-curl now follows HTTP redirects itself rather than letting cURL do it. Previously only the first hop was validated, and a 302 to `169.254.169.254` or an RFC 1918 address reached the model (todo 007, P1). cURL now runs with no `-L` and with `-q` first, so it reads no config file, and each spawn is exactly one hop. `executeCurlRequest` reads the status and target from the `-w` block and sends every hop back through the host list, the SSRF check with its own `--resolve` pin, and the rate limit. A cross-origin hop keeps only `Accept`, `Accept-Language`, `Accept-Encoding` and `User-Agent`, plus the body headers when the body is kept.

## What was implemented

- **Method table and cross-origin rule:** `src/lib/tools/redirect-hop.ts`, new and pure.
  - `FOLLOWED_REDIRECT_STATUSES` (301/302/303/307/308).
  - `CROSS_ORIGIN_FORWARDED_HEADERS`.
  - `sameOrigin`, which compares scheme, `canonicalHost` and `effectivePort`.
  - `nextHopParams`. A 303 turns every method but HEAD into a body-less GET; 301/302 do so for POST; 307/308 keep method and body.
  - Each closed set is stated once, per rule 04.
- **Hop loop:** `src/lib/tools/curl-execute.ts::executeCurlRequest`, plus the helpers `gateHop`, `redirectTarget` and `safeUrl`.
  - One deadline covers the chain. `--max-time` takes the fractional remainder, and a spent deadline is refused before the spawn.
  - The output directory is resolved once, on hop 1.
  - Only the final hop is parsed for output: `include_headers`, `verbose` stderr and hooks all see that hop.
  - At hop 2 and later, every refusal is `LOCAL_REDIRECT_REFUSED`, carrying a fixed reason and `requestsSent`.
- **Builder:** `src/lib/execution/curl-args-builder.ts::buildCurlArgs`.
  - `-q` is now first, and `-L`, `--max-redirs` and `--proto-redir` are gone.
  - `CurlArgsParams` lost `follow_redirects` and `max_redirects`.
- **Shared helpers:**
  - `utils/url.ts::effectivePort`, used by `ssrf.ts` and `redirect-hop.ts`.
  - The `address-blocked` reason in `utils/error.ts` now also covers a target that did not resolve.
- **Test fixture:** `src/lib/execution/loopback-server.test-fixture.ts` holds `serveResponses`, `serveOnce` and `closeLoopbackServers`, extracted from `command-executor.test.ts`.
- **Docs:** `docs/architecture/architecture.md`, in Workflow #1, the invariants bullet, *Network / SSRF Defense* and the design-decision row.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Parse once per hop; no `UrlValidationResult.href` (D1, operator) | PR-1 already normalises `params.url` to the WHATWG `href` for every check and for cURL, so a second carrier would state the rule twice | Plan task 10's `UrlValidationResult.href` |
| Extract `effectivePort` (D2, operator) | `sameOrigin` needs the same port rule `validateUrlAndResolveDns` computes inline | Inline it in `redirect-hop.ts` |
| Widen `address-blocked` to "blocked … or did not resolve" (D3, operator) | The closed reason table had no reason for a DNS failure at hop 2 and later. Only `LOCAL_REDIRECT_REFUSED` uses that reason, and the validator's own messages name the remote's host (RC-30) | A new reason, which would need typed DNS errors from `ssrf.ts` |
| Todo 007 deleted (operator) | The operator asked for it. Its acceptance criteria are met by `curl-execute.redirects.e2e.test.ts` | `status: complete`, keeping the file (D4) |
| `-q` first in the argv (P1, operator: "fix it here") | A `.curlrc` holding `location` re-enabled following inside a spawn (measured) | File it as a todo |
| No sticky cross-origin flag | A teeth probe of `||=` failed nothing: each hop is built from the last, so what a hop dropped cannot return | Keep the flag |
| The loopback fixture binds `localhost` for gated requests | The SSRF gate refuses the `127.0.0.1` literal as a hostname even with localhost allowed. `localhost` resolves to `::1` here, and binding by name follows the same lookup the gate pins | Bind `127.0.0.1` |

## What to pay attention to during review

- **`gateHop`'s two arms.** Hop 1 refuses in each check's own words (unchanged behaviour). A redirect hop maps every failure to a fixed reason. The duplication is filed as todo 025.
- **The `followed` predicate** needs all of these before it follows: `follow_redirects !== false`, exit 0, `metadataFound`, a known status and a followed status. An empty target ends the chain; an `undefined` target (over the bound or carrying a control byte) is refused.
- **The cap.** It refuses when `requestsSent > maxRedirects`, after the spawn whose 3xx would exceed it. `max_redirects: 0` refuses the first redirect, with 1 request sent.
- **`-q` must stay `args[0]`.** cURL ignores it in any other position.
- **The saved-file name** now derives from the final hop's URL. `createSafeFilenameBase` sanitises it.

## Known issues and limitations

- **Proxy environment variables bypass the `--resolve` pin**, on every hop including hop 1. This predates the branch; `-q` does not cover environment variables. Not filed.
- **A hop-2 DNS lookup is not bounded by the deadline** (todo 024).
- **The chain-timeout error carries no `requestsSent`.**
- **Each hop takes a rate-limit slot.**
- **`include_headers` and `verbose` report the final hop only.** This is a behaviour change for the CHANGELOG in PR-5.
- **The `(RC-19)` citation in `gateHop`'s doc-comment is loose.** It is inherited from the plan; RC-19 is about bounding the limiter maps.
- **The `-q` fix was made after the Surface-2 review** and has not been reviewed since (K-16).

## Testing summary

**Tests added:**
- `redirect-hop.test.ts`: 56 tests, covering the method table (5 statuses × 9 method shapes), `sameOrigin` and the strip.
- `curl-execute.redirects.test.ts`: 26 tests, with cURL mocked per hop. They cover the per-hop gate, pin and spawn URL, the host, SSRF and rate refusals with no echo, the parsed href, the cap, `max_redirects: 0`, `follow_redirects: false`, an empty target, unfollowed 3xx statuses, a non-zero exit, an undetermined block, five unusable-target shapes, the deadline, the cross-origin strip, the POST→GET rewrite and 307 keeping the method and body.
- `curl-execute.redirects.e2e.test.ts`: 7 tests against real cURL on loopback. They cover todo 007's three targets, a positive control, the cross-origin strip, POST→GET and the `.curlrc` case.
- Builder: `-q` first, and no redirect flags.

**Verdict:** the vitest JSON reporter (`npx vitest run --reporter=json`, artefact parsed) gave 1716 total, 1709 passed, 0 failed, 7 skipped, `success: true`. That ran through `npx`, not the declared `npm test`, which is the same `vitest run`.

**Typecheck and lint:** `tsc --noEmit` is clean. There is no lint script.

**Teeth:** each of these, when removed, failed a named test: the hop host check, the hop SSRF gate and pin, the hop rate check, the spent-deadline guard, and `-q`. Each source was restored from a `cp` copy and `cmp`-verified.

**Measured on cURL 8.7.1:**
- `redirect_url` passes `\@` through raw.
- `--max-time` takes decimals; `--max-time 0` means no limit.
- A `.curlrc` holding `location` makes cURL follow, and `-q` stops it.

**Gaps:**
- The real-cURL suite depends on `localhost` resolving to a loopback address.
- `npm run build` was not run. `dist/` is tracked and already dirty, and the plan rebuilds it in PR-5.

## Commit history

```
95266d0 fix(execution): pass -q first so no .curlrc can follow redirects
eba93fd docs(review): Surface-2 review of per-hop redirects
fa71245 docs(architecture): every redirect hop is validated and pinned
814961f feat(redirects): follow redirects one gated hop at a time (closes todo 007)
597f310 feat(redirects): method table and cross-origin header rule for a followed hop
```

## Review context

**Suggested order:**
1. `redirect-hop.ts` and its test.
2. `curl-execute.ts` (`gateHop`, `redirectTarget`, the loop).
3. `curl-args-builder.ts`.
4. The two redirect suites.
5. `architecture.md`.

**Related material:** plan PR-3 (tasks 8–12), invariants 2 and 13, RC-30, RC-31, RC-56. The `.curlrc` lesson is RC-66 in `.sixees/LESSONS.md`.

**Depends on:** PR-1 (#50, host policy) and PR-2 (#51, the `-w` parser).

## Follow-up work

- [x] Todos 024–027 (P3): 024–026 fixed, 027 closed without a change, all four files deleted (operator, 2026-10-29).
- [ ] PR-4: header sync, the rate-limit refusal shape, the `//` move.
- [ ] PR-5: the CHANGELOG `**BREAKING:**` bullets. Include final-hop-only `include_headers`/`verbose`, the method rewrite and the cross-origin strip.
- [x] Run `/sixees-workflow:file-lessons --flush` before the merge: RC-65 (staged earlier from #48) and RC-66 written, 2026-10-29.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| 024 | P3 | A redirect-hop DNS lookup runs outside the chain deadline | Surface 2, performance-oracle |
| 025 | P3 | The per-hop gate sequence is written twice in `gateHop` | Surface 2, pattern-recognition-specialist |
| 026 | P3 | The "origin did not parse" arm in the redirect loop is unreachable | Surface 2, code-simplicity-reviewer |
| 027 | P3 | The method table types `method` as `string` | Surface 2, typescript-reviewer |

None of these is outstanding any more; see *Resolved Todos*.

### Resolved Todos

| Id | Title | Summary | By | Date |
|---|---|---|---|---|
| 007 | SSRF validation covers the first hop only | Every hop is gated and pinned; cURL runs without `-L` and with `-q`. The file was deleted at the operator's request | Claude Code | 2026-10-28 |
| 024 | Redirect-hop DNS lookup runs outside the chain deadline | `gateHop` races `validateUrlAndResolveDns` against the deadline via the new `utils/timeout.ts::withTimeout`, on every hop, as a timeout and never a refusal. The lookup itself is not cancelled. The two existing hand-rolled race-with-timer sites (`session-manager.ts::closeWithTimeout`, `McpCurlServer` HTTP shutdown) now use the same helper | Claude Code | 2026-10-29 |
| 025 | Gate sequence written twice in `gateHop` | One sequence. A `check(reason, run)` wrapper rethrows on hop 1 and maps to `LOCAL_REDIRECT_REFUSED` on a redirect hop. Both arms read the host through `safeHostname` | Claude Code | 2026-10-29 |
| 026 | Unreachable origin guard | Hop 1 is gated before the loop and `origin` is `new URL(params.url)` after it, so the type has no `undefined` and the unusable-target refusal names only the target | Claude Code | 2026-10-29 |
| 027 | Method typed as `string` | Closed without a change at the operator's instruction | Claude Code | 2026-10-29 |

## Review Comments Addressed — 2026-10-29

Surface 3, round 1 (CodeRabbit, Codex) on `16cf078`. Severities below are mine, re-derived from consequence; the bots' labels are noted.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| URL globbing turns one gated hop into several requests (two threads, one finding) | @coderabbitai (Major), @chatgpt-codex-connector (P2) | Fix needed, P2 in scope | `buildCurlArgs` passes `--globoff` after `-q`. Measured on cURL 8.7.1: `/item[1-3]` was 3 requests, now 1 literal request. Hop 1 is covered by the same flag |
| Inherited URL credentials make a same-origin redirect refused | @chatgpt-codex-connector (P2) | Fix needed, P2 in scope | Measured: cURL writes the credentials it sent (`-u` or URL userinfo) into `%{redirect_url}`, so **every** `basic_auth` caller had same-origin redirects refused, not only URL-userinfo callers. `redirectTarget` strips userinfo equal to the hop's `basic_auth` and still refuses any other; request-URL userinfo is moved into `basic_auth` first (`-u` already won over it), so there is one source to compare and the cross-origin strip covers it |
| `Transfer-Encoding` survives a body-dropping redirect | @coderabbitai (Minor, review body) | Fix needed, P3 one-liner in a new closed set | Added to `BODY_HEADERS` in `redirect-hop.ts` |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Document per-hop redirect handling in the `curl_execute` description | @coderabbitai (Trivial, review body on `379dcaf`) | P3 | In the plan, not this PR | Already decided: plan PR-5 task 17 owns the description trim and restates `follow_redirects`/`max_redirects` once in the schema `.describe()`; the CHANGELOG bullets for final-hop-only output are PR-5's too |

### Decisions Revised

None.

### Resolved Todos

None this round.

### Outstanding Todos

None filed this round.

### Files Modified

`src/lib/execution/curl-args-builder.ts`, `src/lib/execution/curl-args-builder.test.ts`, `src/lib/tools/curl-execute.ts`, `src/lib/tools/curl-execute.redirects.test.ts`, `src/lib/tools/curl-execute.redirects.e2e.test.ts`, `src/lib/tools/redirect-hop.ts`, `src/lib/tools/redirect-hop.test.ts`, `docs/architecture/architecture.md`.

Teeth: removing `--globoff` fails 2 tests; removing the echo strip fails 3; removing `transfer-encoding` fails 8; removing the userinfo move fails 2. Suite 1721 passed, 0 failed, 7 pending; `tsc` clean.

## Review Comments Addressed — 2026-10-29 (round 2)

Surface 3, round 2 (CodeRabbit, Codex) on `b4f8f4d`. Codex: "Didn't find any major issues." Severities are mine.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| The per-hop pinning statement omits that a proxy bypasses `--resolve` | @coderabbitai (Minor) | Documentation, P3 in scope (the sentence was changed on this branch) | `architecture.md` → *Network / SSRF Defense — strategy* now states that cURL inherits the server's environment, that `http_proxy`/`https_proxy`/`ALL_PROXY` route through a proxy that resolves the host itself, and what an operator does about it |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| `InstanceUtilities.executeRequest({ timeout: 0 })` now times out at once instead of using 30 s | @coderabbitai (Minor) | P3 | In scope (the deadline is new) | No consequence for documented input. `timeout` is documented as 1–300 seconds (`CurlExecuteSchema`, `McpCurlConfig.defaultTimeout`, `docs/configuration.md`). 0 was never "use the default": it reached that only because the old builder skipped a falsy `--max-time`. Mapping it to 30 s would accept an invalid value silently (K-2); refusing it at once is the fail-closed direction |

### Decisions Revised

None. No todos filed or resolved.
