# Work Handoff: fix/sync-quota-and-failed-exit
**Date:** 2026-10-30 | **Branch:** fix/sync-quota-and-failed-exit | **Plan:** — (consumer report, free-text) | **Status:** complete — both reported defects fixed; review todos 028–030 resolved in round 2; one round-2 P3 declined

> Created during review (`/sixees-workflow:review`, run inside `/sixees-workflow:work` Step 5), before the work run's own handoff. The work run's sections are added below this record.

## Code Review — 2026-10-30

**Certification:** complete
**Roster closure:** closed. unresolved: pattern-recognition-specialist → "The correctness of any single instance → whichever reviewer owns that lane"
**Scope:** `376a5dc..HEAD` (fork-point arm), 3 commits.
**Agents used:** security-sentinel, code-simplicity-reviewer, data-integrity-guardian, learnings-researcher (floor); typescript-reviewer, performance-oracle, architecture-strategist, pattern-recognition-specialist (configured).
**Findings:** 3 classes — P1 0 | P2 1 | P3 2. Filed 3, declined 0, investigate-first 0, escalated 0, rejected 0.

**Handoff assessment:** no handoff existed when the review ran; the builder's account was given in the dispatch prompt and was verified against the code. It did not disclose the P2 below: the builder tested the marked result straight into `createWrapper` and through `executeWithHooks`, both of which keep the object, and did not test a result that embedder code rebuilds, which the repository's own docs teach.

### Key findings

| Severity | Class | Todo |
|---|---|---|
| P2 | `fail-open-default` — spotlighting a failed request rides on a mark a rebuilt result drops; regression versus 5.2.0 for a custom tool written as `docs/custom-tools.md` shows | 028 |
| P3 | `stale-comment` — prose names `curl_execute` as the only spotlighted error result; the mark covers YAML endpoints and pass-through custom tools too, and the `[5.3.0]` CHANGELOG says custom-tool errors are unchanged | 029 |
| P3 | `dead-code` — `markRemoteContent`'s try/catch guards a frozen input its only caller cannot produce | 030 |

### Verified claims

| Claim (builder's dispatch account) | Checked | Result |
|---|---|---|
| Pad is `min(quota − remaining, max) − total`; quota defaults to max; quota < max refused | security-sentinel, performance-oracle, typescript-reviewer read `applyServerRemaining` and `parseSyncFromHeaders` | holds |
| Every non-zero exit sets `isError` on both shapes | security-sentinel read every `isError` return | holds |
| The mark survives to the wrap | security-sentinel traced 3 in-repo paths | holds in-repo; fails where embedder code rebuilds the result (028) |
| Refusals, thrown errors and custom-tool errors keep today's shape | pattern-recognition-specialist | false for a custom tool returning a failed `executeRequest` result unchanged (029) |
| Tests pass | not re-run by the review; the work run's verification covers it | — |

### Outstanding todos

| Todo | Priority | Description | Source |
|---|---|---|---|
| 028 | P2 | Spotlighting a failed request rides on a mark a rebuilt result drops | Surface 2 |
| 029 | P3 | Prose names one tool as the spotlighted error exception | Surface 2 |
| 030 | P3 | `markRemoteContent` guards a frozen input its only caller cannot produce | Surface 2 |

**Open without a todo:** none. **Blockers:** none at P1. Todo 028 is a regression this branch introduces; whether it ships unfixed is the operator's call.

## Code Review — 2026-10-30, round 2 (commit `761093c` only)

**Scope:** `59c99b3..761093c`, the inverted-mark fix, pointed at the newest text on the branch (K-16). **Agents:** security-sentinel, architecture-strategist. Not a full `/sixees-workflow:review` run; no certification line is claimed for it.

| Severity | Class | Reviewers | Disposition |
|---|---|---|---|
| P2 | `misplaced-decision` — `generator.ts::createToolHandler`'s catch arms return unwrapped, and the public `registerEndpointTools` adds no outer wrap (invariant 1); pre-existing, but `761093c`'s comment claimed they were spotlighted | architecture | **fixed** in `9cb1f7c`: each arm takes the handler's own wrap; 3 tests at `registerEndpointTools`, all failing with the wrap removed |
| P3 | `misplaced-decision` — `utilities().executeRequest` builds the URL-resolution error unmarked while the docs said every such error is | architecture | **fixed** (docs) in `9cb1f7c`: the docs name `curl_execute`'s error only; the unmarked path fails safe (spotlighted) |
| P3 | `stale-observation` — the mark covers the result object, not its parts, so a marked refusal changed in place keeps it | security, architecture | **declined**: no path in this repository mutates a marked result; the actor would be the embedder's own custom-tool code; spotlighting is opt-in and sanitise and detect still run (rule 42, K-14). Recorded in `post-processor.ts` beside `SERVER_AUTHORED` and in architecture.md → *Spotlighting* |

Both reviewers confirmed no remote or model-controlled byte reaches a marked result, and the symbol is not forgeable from outside. The mark has now had two review rounds; a third proposing more machinery on it should be weighed against cutting it (rule 42).

## Summary

The one consumer reported two defects in 5.2.0. The rate-limit header sync spent the safety margin an operator keeps by setting `max` below the upstream quota, and a failed cURL request (exit 7) came back with no error flag, reading as an empty success. `rateLimit.syncFromHeaders` gains an optional `quota`, and every non-zero cURL exit now sets `isError`. Because the wrap skipped spotlighting on error results, a failed request needed protecting too. The first attempt marked remote text, and Surface 2 found that a rebuilt result dropped the mark (todo 028). The operator chose to invert it: with spotlighting on, every result is spotlighted unless a module-private mark says this server wrote it. Released as 5.3.0, a MINOR by the RC-67 decision.

## What was implemented

- **Sync quota** (`e3a8b3c`). `types/rate-limit.ts::HostRateLimit.syncFromHeaders` gains `quota?: number`. `security/rate-limiter.ts::applyServerRemaining` pads to `min((quota ?? max) − remaining, max) − total`. `parseSyncFromHeaders` (now taking `max`) refuses an unknown key, a non-positive-integer `quota`, and a `quota` below `max`. Docs: `docs/configuration.md` → *rateLimit*, `McpCurlConfig.rateLimit`, `configure()`'s `@throws`.
- **Failed request is an error** (`59c99b3`). `tools/curl-execute.ts::executeCurlRequest` sets `isError: true` on both output shapes whenever `exitCode !== 0`; the remote-content mark this commit wrapped it in was removed in `761093c` below. `response/formatter.ts::plainBranchNotices` reads `cURL exited N: the request failed, and the response above may be empty or incomplete` (the `cURL exited N` prefix is kept, so existing matchers hold).
- **Spotlight everything but server text** (`761093c`, replacing `59c99b3`'s remote-content mark). `response/post-processor.ts` holds a module-private `SERVER_AUTHORED` symbol set by `markServerAuthored`; `createWrapper` spotlights when the flag is on and the result is unmarked. `hasOwnWrappedTag` became `hasOwnTag(result, key)`. Marked: `executeCurlRequest`'s `LocalRefusalError` arm, `tool-wrapper.ts`'s `resolveRequestUrl` error, and `generator.ts::createToolHandler`'s authentication and refusal arms. Internal only: not exported from `src/lib.ts`. The rule is stated once in `docs/architecture/architecture.md` → *Spotlighting*.
- **Generator error results wrapped** (`9cb1f7c`). `createToolHandler`'s three catch arms take the handler's own wrap, so the public `registerEndpointTools` path is wrapped (invariant 1).
- **Release** (`fec8759`). CHANGELOG `[5.3.0]`, `package.json`/lock to 5.3.0, `dist/` rebuilt.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| A static `quota` number, not a limit header | The operator chose it; the consumer asked to "give the sync the API's real quota", and no extra `-w` field or parser change is needed | Read the quota from a header per response |
| `quota` defaults to `max`; below `max` is refused | Keeps 5.2.0 behaviour for existing configs; a lower quota would loosen the limit rather than keep a margin | Allow any positive quota |
| `isError` on every non-zero exit, both shapes | The operator chose it; a flag is what a client acts on, and a notice alone was overlooked | Reword the notice only (keeps the hook contract) |
| Mark server text, not remote text (todo 028) | The operator chose it after Surface 2: a lost mark must fail safe, and a remote-content mark is lost by any rebuild | Export `markRemoteContent` and fix the doc handlers; change the doc handlers only |
| Mark only refusals, `curl_execute`'s URL error and the generator's auth error | The text whose first line matters and which is wholly server-built. `jq_query` and generic cURL errors can echo remote bytes; the preset error echoes the model's parameter; `utilities()` usage errors had no test and fail safe | Mark every server-built error |
| Decline freezing a marked result's parts | No in-repo mutation; the actor is embedder code; opt-in layer; sanitise and detect still run | `Object.freeze` the parts at mark time |
| Shipped as 5.3.0 | RC-67: single consumer, told directly | 6.0.0 |

## What to pay attention to during review

- `post-processor.ts::createWrapper` is a §7 high-surface trigger (the wrap). With spotlighting on, error results are now spotlighted unless marked server-authored; CHANGELOG `[5.3.0]` lists it as `**BREAKING:**`.
- The declined round-2 P3: a marked refusal changed in place keeps its mark.
- `AfterResponseHook` consumers now see `isError: true` for failed requests (CHANGELOG *To adjust*).

## Known issues and limitations

- `utilities().executeRequest`'s own usage errors are unmarked, so with spotlighting on they arrive in sentinels if a custom tool forwards them.
- The `!enabled` arms of `registerCurlToolWithHooks` and `registerJqToolWithHooks` return unwrapped results (pre-existing, noted by architecture-strategist, not touched).
- The generic thrown-error arm of `executeCurlRequest` and `jq_query`'s error arm still return unmarked `isError` results that may carry remote text. Pre-existing, unchanged, noted by security-sentinel and architecture-strategist.

## Testing summary

- **Added:** `rate-limiter.test.ts` (quota parse cases; margin kept; stop at the margin; cap at `max`); `post-processor.test.ts` (a marked `isError` result is spotlighted; not when spotlighting is off; the mark does not serialise); `tool-wrapper.test.ts` (the mark survives `executeWithHooks`; a hook sees `isError: true`); `curl-execute.headers.test.ts` (exit 7 sets `isError` on both shapes; a clean exit does not; exit 28 after a JSON body is spotlighted through the real wrap); `mcp-curl-server.test.ts` (a real cURL exit 7 against a closed loopback port is an error).
- **Teeth:** reverting the pad to `max − remaining` fails 2 tests; removing the `Math.min` cap fails 1; removing `isError` fails 4; removing the executor's mark fails 1; the wrap ignoring the mark fails 3. Each mutation was restored from a `cp` backup and checked byte-identical.
- **Verdict:** `npm test -- --reporter=json --outputFile=…` (the declared command, type-check included, with vitest's JSON reporter) → `success: true`, 1792 total, 1785 passed, 0 failed, 7 skipped. The work command lists vitest among runners whose structured mode it does not trust, so the operator's own run is the gate.
- **Round 2 added:** `post-processor.test.ts` (an unmarked `isError` result is spotlighted; a copy of a marked result is spotlighted); `mcp-curl-server.test.ts` (todo 028's acceptance case, a custom tool's rebuilt error result is spotlighted; the generator's refusal and auth error keep their first lines through the custom-tool wrap); `tool-wrapper.test.ts` (the resolver's refusal is not spotlighted); `curl-execute.headers.test.ts` (a local refusal keeps its first line); `schema.test.ts` (`registerEndpointTools` wraps all three error arms).
- **Round 2 teeth:** wrap back to the `isError` rule fails 6; each mark removed fails its own test; the generator's catch-arm wrap removed fails 3. **A false green was caught on the way (K-1):** the first generator mark tests called the handler directly, skipping the wrap that reads the mark, and removing both marks failed nothing; they were moved to the custom-tool boundary and re-probed.
- **Final verdict:** `npm test -- --reporter=json …` → `success: true`, 1798 total, 1791 passed, 0 failed, 7 skipped.
- **Gaps:** no YAML-endpoint test of a failed request being spotlighted end to end through `createApiServer`.

## Commit history

```
9cb1f7c Wrap the generator's error results on every registration path
761093c Spotlight every result except this server's own error text
a0346b2 Record the Surface 2 review: handoff stub and todos 028-030
fec8759 Release 5.3.0: CHANGELOG, version bump and dist rebuild
59c99b3 Report a failed cURL request as an error, and keep it spotlighted
e3a8b3c Keep the margin under the upstream quota when the sync tightens
```

All commits were made with `git -c core.hooksPath=/dev/null`; no hooks are configured in this clone.

## Review context

Suggested order: `e3a8b3c` (self-contained), then `59c99b3` reading `post-processor.ts` before `curl-execute.ts`, then the CHANGELOG in `fec8759`. Invariants touched: 1 (the wrap), 11 (published contract, settled by RC-67).

## Follow-up work

- [ ] Surface 3 has not run.
- [ ] Flush the staged RC (`docs/work/RC/sync-remaining-is-relative-to-the-upstream-quota.md`) before merge.
- [ ] Tell the consumer: set `quota: 240`; failed requests now carry `isError`; with spotlighting on, error results are spotlighted.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| — | — | none open | — |

### Resolved Todos

| Id | Title | Summary | By | Date |
|---|---|---|---|---|
| 028 | Spotlighting a failed request rides on a mark a rebuilt result drops | mark inverted to server-authored | Claude Code | 2026-10-30 |
| 029 | Prose names one tool as the spotlighted error exception | rule stated once in architecture.md, cited elsewhere | Claude Code | 2026-10-30 |
| 030 | `markRemoteContent` guards a frozen input its only caller cannot produce | subject deleted by 028's fix | Claude Code | 2026-10-30 |
