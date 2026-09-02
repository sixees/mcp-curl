# Work Handoff: Route every undefended tool channel through defendText

**Date:** 2026-09-02 | **Branch:** `fix/defend-undefended-tool-output` | **Plan:** `docs/todos/001-jq-query-shorter-defence-path.md` (removed; see *Resolved Todos*) | **Status:** complete, with two P1s found in review and one design question deferred — see *Reality Corrections* and *Outstanding Todos*

> **Review round 1 changed this branch substantially.** Six reviewers found
> three P1s, two of them in code this branch introduced, and the director
> reversed one decision the branch had made three hours earlier. Everything
> below the *Summary* has been updated to the post-review state; the
> *Reality Corrections* section is where the changes of mind are recorded.

## Summary

Todo 001 filed two channels as taking "a shorter defence path than `defendText`".
The audit found the todo's recommended fix was a no-op and its headline instance
was not a defect — but the sibling instance it rated second **was**, and it was
the one that mattered: `post-processor.ts::processTextPart`, the only defence
for `registerCustomTool()` returns, `beforeRequest` short-circuits and YAML
endpoint results, ran `sanitizeAndDetect` alone. Those channels reached the
model with markdown exfiltration beacons and `<script>` blocks intact.

The wrap now runs the full pipeline on every text part, with no exemption —
including text `curl_execute` and `jq_query` already defended under a real
Content-Type, which therefore takes a second, less-informed pass. (A `DEFENDED`
tag to suppress that was built and then removed; see below.) `defendText` became
a public export, because the published guidance for non-MCP consumers pointed at
Step 2 and called it the whole thing.

## What was implemented

### The defence (`src/lib/response/post-processor.ts`)

`processTextPart` calls `defendText(text, { hostname, contentTypeUndetermined:
true, excludeJsonDocuments: false, decodeEntities: false })` on every text part. `contentTypeUndetermined`
is not a stand-in for "no content type" — it is literally true here, and it
selects the strictest grammar so that losing the metadata can never be how a
stage gets switched off. `decodeEntities: false` follows the header channel's
precedent (RC-3): the decode's output is returned, so on a channel whose
consumer does not decode it manufactures live markup from inert bytes.

### The `DEFENDED` tag — introduced, then removed in the same branch

**It is not in the final diff.** It was added to stop the wrap double-processing
text `curl_execute` and `jq_query` had already defended, and review showed its
claim was worth less than it looked: "took `defendText` under the origin's
Content-Type" is true for `application/json` and `text/plain` while meaning
Step 2 and no strip stage at all. The origin picks the Content-Type, so the
origin picked whether the exemption applied. RC-1's shape, in code written by
the same run that quoted RC-1. Removed in full — see RC-10.

<details><summary>What it was, for the reader tracing the commit history</summary>

Module-private `Symbol()`, mirroring the existing `WRAPPED` tag and reusing its
hostile-Proxy probe — `hasOwnWrappedTag` was generalised to `hasOwnTag(result,
key)` and `tag()` to `setTag(result, key)` rather than copied.

The tag asserts: *this result's text needs no strip stages, because every part
of it is either server-authored or already took `defendText` under the content
type the origin declared.* Claimed by `curl_execute`'s and `jq_query`'s **success**
returns only. Both **error** returns keep the untagged default — that text is
assembled from exception messages, and `applyJqFilter`'s invalid-JSON error
quotes a preview of the file it was reading.

</details>

### `jq_query` (`src/lib/tools/jq-query.ts`)

Now calls `defendText(filtered, { contentType: JSON_MIME, hostname })` instead
of reproducing that arm by hand. **Zero behaviour change** — `defendText` on a
JSON document is sanitise-and-detect — but the channel now follows if the JSON
grammar's treatment ever changes. Both success branches route through one
`defendedResult()` helper so the tag and the result shape have a single site.

### Public API (`src/lib.ts`, +`JSON_MIME` in `utils/content-type.ts`)

`defendText` and `DefendTextOptions` exported. `docs/custom-tools.md` rewritten:
its table row claiming `sanitizeAndDetect` was "the same defence the built-in
tools apply" is now a warning that it is Step 2 of five, and the wrap section
describes the real pipeline with a 3.4.0 upgrade note.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|---|---|---|
| Fix the wrap, decline the `jq_query` half | `jq_query` can only return JSON, and `defendText` on JSON *is* what it already ran. The gap was JSON-vs-everything, not this tool. | Strip inside JSON everywhere; document and close nothing |
| **Reversed:** strip inside JSON at the wrap after all | Review showed RC-8's justification is about a PERSISTED artefact and does not reach a channel with no disk artefact. Director's call. RC-10. | Keep the exemption everywhere (leaves a live beacon vector on the wrap's channels) |
| **Reversed:** the `DEFENDED` tag, then removed | Its claim rested on a field the origin controls, and the `include_metadata` incoherence it was built to fix did not survive it either. RC-10. | Make the claim true by having `defendText` report whether the strip ran; drop the tag (chosen) |
| Exclude `[` from the beacon label class rather than capping it | The docblock records that a 256-char cap was removed *because* padding past it defeated all four patterns. A cap is a settled reversal. **Revised during review — the claim "linear by construction" was wrong:** the exclusion bounds the LABEL, and the URL class `[^)\n]+` still scanned to end-of-input (2.9 s measured). The exclusion stays; linearity now comes from the `)` bound. Based on @chatgpt-codex-connector's feedback. | Cap the label (rejected: reinstates a known bypass); linear left-to-right scan (larger rewrite, and todo 005 will need it) |
| ~~Bound the block scan to the region a `>` closes~~ | **Revised during review — changed to bounding at each pattern's own closing token.** `>` is not the token a `</script>` closer needs, so `"<script>".repeat(32000)` kept the whole input in scope: 1.1 s measured, and `"<script></x>".repeat(20000)` 1.7 s. Based on @chatgpt-codex-connector's feedback. The soundness argument was right and applied to the wrong token. | Exclude `<` from the OPENER's attribute run (rejected: `<script foo="<">` bypasses); cap the run (same settled reversal) |
| Bound every strip pass at its own closing token | One helper, `withinClosableRegion`, rather than a per-pattern argument — the class is *a failing attempt can scan to end-of-input*, and it recurred because each fix was aimed at an instance. Escalation-ladder rung 1: put the invariant where no pattern can forget it. | Per-pattern bounds (how it failed twice); a hand-written scanner |
| Exclude `<` from the CLOSER's attribute run (round 2) | Not the settled reversal above, which is about the OPENER: a closing tag takes no attributes, so nothing legitimate is lost, and a closer that swallows `<` swallows the openers that follow it — which is what kept `"</script " + "<script".repeat(35000) + \">\"` quadratic at 9 s. The pattern and the bound now agree on it. | Leave the pattern and special-case the bound (rejected: two spellings of one rule, and the pattern is the one that decides) |
| Replace the comment strip with a scanner, not a third regex bound (round 2) | Escalation-ladder rung 3 — the layer could not answer the question. An iterated `replace` exposes exactly one splice layer per pass, so no iteration cap converges: five layers beat a cap of four. A scan testing the OUTPUT tail converges by construction and removes the ReDoS class from that path entirely. Both comment regexes deleted. | Raise the iteration cap (rejected: the attacker picks the depth); loop to a fixed point uncapped (rejected: O(n²) on `\"<!\".repeat(k) + \"--\".repeat(k)`) |
| Neutralise an orphan opener instead of deleting to EOF | CodeQL's rule is about the residual TOKEN, which removal satisfies. Deleting the caller's payload was never the requirement. | Keep the arm and add a byte-count notice (see below) |
| **Declined:** the `[mcp-curl] N bytes removed` notice | You approved it alongside the P1-B fix, and its justification was the *silent unbounded* loss. That loss is gone — every remaining removal is a bounded substitution that announces itself (`[link removed]`) or leaves the body visible. A byte counter on every stripped response would be noise. Flagging rather than burying, since you asked for it. | Add it anyway |
| **Reverted:** the RC-3 scratch-copy decode | Built it; the commit rule cannot serve both channels. See RC-12 and todo 004. The half that is unambiguous — never entity-decode a JSON document — did land. | Ship the naive version (loses the detector and the sanitiser on masked payloads) |
| `contentTypeUndetermined` becomes required | Absence resolved to the permissive arm on a type this release publishes. Not breaking: the type is new in 3.4.0. **Both halves shipped:** the field is required so a TypeScript caller must decide, AND `defendText` destructures it with `= true`, so a JavaScript caller who omits it gets the STRICTEST grammar rather than the permissive one. A caller passes `false` only when the content type is known. | Discriminated union (larger, same effect); leave it and document (the doc snippet I wrote had the unsafe arm uncommented — fixed in round 5) |
| Bump to 3.4.0 | Additive export, no breaking change. | Major (nothing removed) |

## What to pay attention to during review

- **Nothing in the final diff weakens a defence** — `markDefended` was the one
  thing that could, and it was removed before the PR opened (RC-10). What is
  left to check is the opposite direction: whether the strip is now *too*
  aggressive on server-authored text, which is what codex's declined
  file-path finding is about.
- **The strip bounds are the highest-risk code here**, and review round 1 found
  the first version of them incomplete on three inputs. If you change a pattern,
  change the token its bound keys on in the same edit, and add a flood that
  omits that token — see `REDOS_BUDGET_MS`.
- **The `contentTypeUndetermined: true` blast radius.** It is the strictest
  grammar on all non-JSON tool output. A custom tool returning `text/plain`-ish
  prose with markdown link syntax now gets `[link removed]`. That is the
  intended posture, and it is a visible change for library consumers.
- **The JSON exclusion is doing a lot of load-bearing work** and is now the real
  answer to "is this channel defended?". Invariant 1a says so explicitly rather
  than letting "calls `defendText`" read as "is fully stripped".
- **`docs/custom-tools.md` is published to npm** (`package.json` → `files`).
  Read the diff as consumer-facing text, not internal notes.
- The layering arrow: `post-processor.ts` now imports `processor.ts`. Both are
  in `response/`, and `processor.ts` does not import back — no cycle.

## Known issues and limitations

- **Steps 3–5 cannot unmask an entity-encoded injection phrase at the wrap**,
  because `decodeEntities: false`. Stated in invariant 1a. It is the same
  accepted cost the header channel carries.
- **A JSON document from a custom tool is excluded from the strip stages**, so a
  beacon inside a JSON string value returned by a custom tool still reaches the
  model. Consistent with every other channel; declined, not deferred (RC-8).
- **`isDefinitelyJson` only recognises `{` and `[` roots.** For an untagged
  channel this errs strict (a string-root JSON document gets the full pipeline),
  which is the safe direction, so it was left alone. Noted rather than fixed.
- **`npm audit --omit=dev`** still reports 11 advisories (pre-existing, `js-yaml`
  the one with a named path into this code). Untouched by this branch.

## Testing summary

- **Suite: 1098 passed, 7 skipped, 32 files** — the reading at the ORIGINAL
  implementation, before five rounds of PR review. The final figure is in the
  round-5 section below; this one is kept as the snapshot it was, not updated in
  place. `npm test` (vitest). Build exits 0. `npx tsc --noEmit`: **0 errors in
  non-test files**; 12 pre-existing test-file errors, unchanged in count and
  location.
- **Verification mode:** vitest has no trustworthy structured reporter per
  `/work` §5, so this verdict is the human-readable summary and the per-mutation
  failures were read by name. **Not a machine-parsed artefact.**
- **Teeth verified against eight source mutations**, each backed up with `cp` and
  restored from the copy before staging (`diff` confirmed byte-identical):

  | Mutation | Named tests that failed |
  |---|---|
  | wrap reverts to `sanitizeAndDetect` | 9 — every strip assertion, unit and end-to-end |
  | `decodeEntities: false` → `true` | 1 — *does NOT decode numeric HTML entities (RC-3)* |
  | tag ignored / tag dropped ×3 | the tag-deference tests (all since removed with the tag) |
  | revert the `>` bound | 3 opener floods, at 8.9 s / 10.5 s / 9.0 s |
  | revert the `[` exclusion | 2 label floods, at **82,879 ms** and 41,645 ms |
  | restore the JSON exemption at the wrap | 2 — the direct case and the `include_metadata: true` branch |

- **One mutation did not bite where expected**, recorded because a silent
  non-failure is the thing worth knowing: restoring the JSON exemption did *not*
  fail `jq-query.test.ts`'s beacon case, because jq output is a string-root JSON
  document and `isDefinitelyJson` only recognises `{`/`[` roots — so the
  exemption never applied to it either way. That test has teeth against the wrap
  running at all, not against RC-10 specifically.
- **Gaps:** no test drives the YAML `createToolHandler` path through the new wrap
  behaviour; it shares the closure with the custom-tool path, which is covered
  end-to-end, but the wiring is asserted only for custom tools.

## Commit history

```
28df3b2 fix(response): route every undefended tool channel through defendText
<pending> docs+api: export defendText, correct the published defence guidance
```

## Review context

Suggested order: `ARCHITECTURE.md` invariant 1a → `post-processor.ts` →
`curl-execute.ts` / `jq-query.ts` tag sites → tests → `docs/custom-tools.md`.

Related: `LESSONS.md` RC-1 (the class, one layer up), RC-3 (`decodeEntities`),
RC-6 (the sweep that missed this). High-surface triggers per the profile §7:
*sanitisation and injection defence* and *public API / contract changes* — both
fire, so all three review surfaces apply.

## Reality Corrections

Three. RC-7 and RC-8 are in `LESSONS.md` in full; summarised here with RC-9,
which is local to this run.

**RC-7 — The recommended fix was inert.** Todo 001's option 1 — call
`defendText` with `contentType: "application/json"` "so the markdown/beacon
stages still run" — runs no strip stage at all. Measured before writing
anything: the call returns its input byte-identical. Files: none changed; the
option was not implemented.

**RC-8 — The instance was mis-scoped.** `jq_query` cannot return non-JSON, and
`defendText` on JSON *is* sanitise-and-detect, so it was never on a shorter
path. The live defect was the sibling instance. Files:
`post-processor.ts::processTextPart`, `markDefended`; `jq-query.ts::executeJqQuery`.

**RC-9 — The agreed `isDefinitelyJson` widening was dropped after the code
argued against it.**

- **Plan said:** the kickoff option the director chose included "fix
  `isDefinitelyJson` to recognise every JSON root (string, number, bool, null),
  not just `{`/`[`", so jq output would be classified consistently rather than
  by which path the caller selected.
- **Reality was:** `isDefinitelyJson` also gates the **body** path in
  `processResponse`, where the input is attacker-controlled. Widening it to
  string roots would let a remote escape the strictest grammar by sending a body
  that is exactly `"…beacon…"`, quotes included — one more spelling of an
  already-accepted bypass (`["…"]` parses today), added to close a coherence
  problem that has a cheaper answer.
- **Correction:** left `isDefinitelyJson` untouched. Tagging `jq_query`'s result
  as defended reaches the same coherence — its output never enters the
  strictest-grammar arm at all — without touching the body path. For untagged
  channels the narrow predicate errs *strict*, which is the safe direction.
- **Files:** `processor.ts::isDefinitelyJson` (unchanged, deliberately);
  `jq-query.ts::defendedResult`.

**RC-10 — A settled decision was reversed by an argument that had not been made
when it was settled.** RC-8 declined stripping inside JSON on the grounds that
`processResponse` persists post-strip bytes. That reasoning does not reach the
wrap, which has no disk artefact. Reversed by the director; `markDefended` and
the `DEFENDED` symbol removed with it. Files: `processor.ts::defendText`
(`excludeJsonDocuments`), `post-processor.ts::processTextPart`. **RC-8 stands
for the body path** — only its reach was wrong.

**RC-11 — A guard's escape hatch was deleting the payload it was guarding.** The
`|$)` arm in the comment and block patterns replaced everything from an unclosed
opener to end of input with nothing. `"before <!-- unclosed\nafter"` → `"before "`.
Pre-existing; this branch added the channel where it bites. Files:
`strip-blocks.ts` — `HTML_COMMENT_PATTERN`, `SCRIPT_BLOCK_PATTERN`,
`STYLE_BLOCK_PATTERN`, and the new orphan-tag patterns.

**RC-12 — Two channels' opposite needs were resolved by a per-caller flag, so
every caller had to choose wrong.** The scratch-copy decode you approved was
built and reverted: no single commit rule serves both the header channel and the
wrap. The unambiguous half landed — a JSON document is never entity-decoded.
Files: `processor.ts::defendText`; attempt preserved in the session scratchpad,
question in `docs/todos/004`.

**RC-13 is not filed, and the reason is worth stating.** The quadratic scan and
the truncation are recorded as RC-11 rather than as separate corrections because
they are one divergence at one site: removing the unbounded arm is what made the
scan boundable, and neither fix stands without the other.

No POST-AUDIT annotation was added to a plan file: the input was a todo, and it
is removed by the todo lifecycle below rather than annotated.

## Follow-up work

- [ ] `docs/architecture/architecture.md` §59 and the mermaid diagram at §107
      still describe the jq_query and wrap steps as "sanitize + injection-detect".
      Imprecise for the wrap since this branch.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/005-bracketed-label-defeats-beacon-strip.md` | **P1** | `[see [1]](https://evil/x)` defeats all four beacon patterns — a complete bypass of the markdown beacon defence. **Pre-existing; found while benchmarking the RC-11 rewrite, not caused by it.** Filed rather than fixed because the fix is a second rewrite of the stage this branch just rewrote, with no review round left. | this run |
| `docs/todos/004-entity-decode-serves-two-channels.md` | P2 | The entity-decode stage cannot serve the header channel and the wrap with one commit rule. RC-12. | security-sentinel |
| `docs/todos/002-header-channel-should-not-be-multiplexed.md` | P1 | `-i` multiplexing; the boundary arithmetic has failed three times. | PR #32 |
| `docs/todos/003-memory-ceiling-released-before-peak.md` | P2 | Pre-existing. | PR #32 |

This run opened two todos of its own (004, 005) and closed one (001), so the
branch is net +1 on its own todos. Both new ones are recorded rather than
dropped, and 005 is a P1 that needs your decision before this branch merges.

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/001-jq-query-shorter-defence-path.md` | Two text channels still take a shorter defence path than defendText | One instance fixed at the shared layer (`processTextPart` → full `defendText`); one refuted and declined with evidence (`jq_query` was never on a shorter path). Recommended remedy found inert. See RC-7, RC-8. | `/sixees-workflow:work` | 2026-09-02 |

## Review Comments Addressed — 2026-09-02 (round 1, PR #33)

Surface 3. Reviewers: `chatgpt-codex-connector`, `coderabbitai`,
`github-advanced-security` (CodeQL, unrequested — it runs on push).

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Bound incomplete HTML-comment matching (P1) | codex + CodeQL | Fix needed | `stripHtmlComments` bounded at the last `-->`. Measured 5.5 s → 1.0 ms |
| Bound searches for missing script/style closers (P1) | codex | Fix needed | `lastTagCloserEnd` keys on `</tag…>`, not a bare `>`. 1.1 s → 0.9 ms |
| Bound failed markdown URL scans (P1) | codex | Fix needed | All five beacon passes bounded at the last `)`. 2.9 s → 0.2 ms |
| Fail closed when JS callers omit the grammar selector (P2) | codex + coderabbitai | Fix needed | Destructuring default in `defendText` is now `true` (strictest). Regression test through the public barrel |
| Incomplete multi-character sanitization ×6 | CodeQL | Fix needed | Orphan `<!--` sweep now iterates: deleting a literal can splice a new one out of its neighbours (`<!<!----`). Script/style were already covered by the fixed-point loop |

Three findings are one class — *a failing match attempt can scan to
end-of-input* — and are fixed at one layer, `withinClosableRegion`, rather than
per-pattern. Instances outside the diff: none; the sweep is the whole file.

**Two things this round proved about the previous one, both worth recording:**

1. **The bound shipped in the PR closed only part of its class.** It keyed on
   `>` and on excluding `[` from a label — neither of which is the token the
   pattern must consume. Sound reasoning applied to the wrong token.
2. **The replacement flood tests were toothless, in the mirror image of the
   guard they replaced.** Every case omitted `>` or `)` entirely, which is the
   shape the bound already handled. With the fix removed, four of the new floods
   still passed at the 2 s budget. `REDOS_BUDGET_MS` is now 100 ms, calibrated
   against a probe: 1–2 ms passing, 243 ms – 10.3 s regressed.

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| "Do not return unclosed raw-text element bodies to the model" — remove the body of an unclosed `<script>` rather than keeping it as inert text | coderabbitai | P2 (theirs: Major) | In scope | **Re-litigates RC-11**, which is the P1 this branch was largely written to fix, and brings nothing that decision did not weigh. RC-11 explicitly considered the model-facing reading and found the courier case dominates. Substantively: the phrase `ignore previous instructions` reaches the model identically when it is *not* wrapped in a tag, so removing the body buys nothing against it — what the strip owes is that no live tag survives, and it does not. Detection logs it and spotlighting wraps it. Flagged to the director rather than silently closed, per `.claude/rules/03-divergence.md` |
| "Preserve generated file paths through the wrapper" — a save path like `/workspace/[report](file:notes)` is rewritten to `[link removed]` | codex | P3 (theirs: P2) | In scope | Real, and requires an output directory whose *name* contains markdown link syntax with a dangerous scheme — a path this deployment creates itself. Demoted from P2 on consequence: no stated failing case that occurs in practice. The fix means re-introducing a per-field exemption at the wrap, which is the `DEFENDED` tag the director removed this branch (RC-10). Not worth reversing a settled decision for a directory name we control |

### Escalated — needs your decision before merge

| Comment | Reviewer | Severity | Why it is not mine to close |
|---|---|---|---|
| "Reapply `max_result_size` after the outer defense" | codex | P2, in scope, **not contained** | Genuine, and it violates **invariant 14** verbatim: *"the cap is applied after the defence pipeline as well as before it, since `[link removed]` is longer than some of the forms it replaces."* This PR adds a second defence pass at the wrap, after `processResponse`'s size gate, so a `text/plain` body of `"[a](file:)".repeat(100)` returns 1400 bytes under a 1000-byte `max_result_size`. The fix needs `max_result_size` plumbed into the post-processor wrap, which has no access to tool params — that reaches outside this PR's diff. Three ways out, all yours: plumb the cap through, amend invariant 14 to acknowledge wrap-side growth, or accept a bounded overshoot and say so in the invariant |

### Outstanding Todos

**0 filed this round.** No finding in either round met the bar for a deferral —
the only out-of-scope-P1 route — and no decline was converted into one.

**4 open in `docs/todos/`, none claimed by this PR.** They are the pre-existing
backlog listed under the earlier *Outstanding Todos* table above (002, 003, 004,
005); none carries `pr: "#33"` frontmatter, so none blocks this merge. The two
numbers differ because they count different things, and an earlier version of
this line gave only the first — which read as a claim that the backlog was empty.

### Files Modified

`src/lib/response/strip-blocks.ts`, `src/lib/response/processor.ts`,
`src/lib/response/strip-blocks.test.ts`, `src/lib.test.ts`,
`ARCHITECTURE.md`, `CHANGELOG.md`, and this handoff.

## Review Comments Addressed — 2026-09-02 (round 2, PR #33)

**Every code finding this round was in code round 1 added.** That is the
expected shape of a second round and it is also the measurement that mattered:
round 1's bound was correct in argument and wrong in three of its details, and
only the third pass over the same class removed it.

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| Keep case-folded search indices aligned (P1) | codex | Fix needed | `text.toLowerCase()` can change UTF-16 length (U+0130 → two units), so offsets taken from the folded copy addressed different characters. Replaced with an in-place ASCII fold, `matchesTagNameAt`. This one was a **correctness** bug, not only a cost one: a single `İ` before a block silently skipped the balanced pass |
| Reject non-boundary tag names as closers (P1) | codex | Fix needed | `lastTagCloserEnd` now requires the same `\b` the pattern does, so `</scripture>` is not a closer. 1.9 s → 7 ms |
| Exclude openers nested inside the bounding closer (P1) | codex | Fix needed | The closer's attribute run is `[^<>]*` in both the pattern and the bound. A closer that swallows `<` swallows openers, and those have no closer after them. 9 s → 1.8 ms |
| Remove every spliced comment opener (P2) | codex | Fix needed | The iterated `replace` exposed one layer per pass, so five layers beat the four-pass cap. `stripHtmlComments` is now a single left-to-right scan testing the OUTPUT tail; convergence no longer depends on a cap. Both comment regexes deleted |
| Incomplete multi-character sanitization ×1 (`<!--`) | CodeQL | Fix needed | Same defect, fixed by the same scanner |
| Remove the unused `decodeEntities` binding | coderabbitai | Fix needed | Dead since the strip branch derived its own. Two spellings of one fact |
| Update the performance acceptance criterion | coderabbitai | Documentation | `docs/todos/005` cited "five floods inside 2 s"; both numbers had changed. Replaced with a pointer to the test file plus the rule that produced the drift |
| Correct the open-todo count | coderabbitai | Documentation | Round 1's "0 open against this PR" sat above a table listing four. Both numbers now stated, with what each counts |

Four findings, one class again — *the bound does not match the pattern it is
bounding*. Fixed at the one helper rather than per-pattern.

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Incomplete multi-character sanitization ×4 on `stripTagBlocks` | CodeQL | P3 | In scope | Same disposition as round 1 and for the same reason: `stripTagBlocks` is only reachable from `stripBlocksFixedPoint`, which iterates to a fixed point, so the splice CodeQL describes is removed by the caller. The rule cannot see across the call. Asserted directly by "leaves no script/style TOKEN behind on any unclosed shape". **The equivalent alert on the comment path was NOT declined either round** — that path genuinely lacked the loop, and now needs none |

### Escalated — unchanged from round 1, now raised by both reviewers

| Comment | Reviewer | Severity | Why it is not mine to close |
|---|---|---|---|
| Reapply `max_result_size` after the outer defence pass | codex (round 1) + coderabbitai (round 2) | P2, in scope, **not contained** | Two reviewers independently, and coderabbitai found it by reading round 1's own handoff entry. Still the same three options: plumb the cap into the wrap, amend invariant 14, or accept a bounded overshoot and say so. Unchanged and still yours |

### Outstanding Todos

**0 filed this round**, same as round 1. The four in `docs/todos/` are the
pre-existing backlog and none carries `pr: "#33"`.

### Files Modified

`src/lib/response/strip-blocks.ts`, `src/lib/response/processor.ts`,
`src/lib/response/strip-blocks.test.ts`,
`docs/todos/005-bracketed-label-defeats-beacon-strip.md`, and this handoff.

## Review Comments Addressed — 2026-09-02 (round 3, PR #33)

**This round exists because round 2's tail read showed a decline was wrong.**

### Changes Made

| Comment | Reviewer | Category | Action taken |
|---|---|---|---|
| The script/style orphan sweep still depends on the iteration cap | coderabbitai | Fix needed | Replaced with `stripTagTokens`, an output-tail scan mirroring `stripHtmlComments`. Measured before: `"<scr".repeat(4) + "<script>" + "ipt>".repeat(4)` returned a live `<script>` — it broke at depth **4**, one worse than reported. No survival now at any depth to 500, for either tag |
| Incomplete multi-character sanitization (`<script`) | CodeQL | Fix needed | Same defect. **Declined by me on the two previous rounds**; see RC-13 |
| Use the complete file path | coderabbitai | Documentation | `docs/todos/005-…` expanded in the round-2 Files Modified list |

| Two remaining CodeQL alerts on the balanced replaces | CodeQL | — | Declined, with evidence — see below |

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Incomplete multi-character sanitization on `SCRIPT_BLOCK_PATTERN` / `STYLE_BLOCK_PATTERN` (lines 417, 420) | CodeQL | P3 | In scope | The balanced passes CAN splice, and this decline does not deny that. They are followed **unconditionally**, in the same function, by `stripTagTokens` over the whole string — so the residue is removed by an ordering property, not by an iteration cap. That distinction is exactly what RC-13 records getting wrong, so this one is backed by measurement rather than by reading: a seeded fragment fuzz plus explicit balanced-splice cases at depths 1–40, both of which fail if the scan is removed |

**And the first version of that fuzz was itself toothless.** It drew single
characters from the token alphabet, so spelling `<script` by chance was about
one in 4e8 per position and it passed with the fix removed. A teeth probe caught
it; it now draws tag halves and splice fragments, and fails against both the
no-scan mutation and the pre-round-3 `replace`. **That is the fourth guard on
this branch whose name was a claim it could not fail** — the pattern is now
named in `ARCHITECTURE.md` invariant 15.

### Decisions Revised

| Original | New approach | Reason | Reviewer |
|---|---|---|---|
| CodeQL's `stripTagBlocks` alerts are false positives — the fixed-point loop handles the splice | The loop's CAP was the defect; the sweep is now a scan that converges without iterating | True below the cap and false above it. Declined in rounds 1 and 2, four alerts each time, while the identical defect on the comment path was being fixed one commit earlier. RC-13 | coderabbitai, CodeQL |

### Outstanding Todos

0 filed this round. The four in `docs/todos/` remain pre-existing backlog.

### Files Modified

`src/lib/response/strip-blocks.ts`, `src/lib/response/strip-blocks.test.ts`,
`ARCHITECTURE.md`, `CHANGELOG.md`, `LESSONS.md`, and this handoff.

### Round 3 outcome

**codex: "Didn't find any major issues"** on `c0878c7` — the first clean
reviewer return on this branch. coderabbitai raised no new inline findings.
The only new entries were the two CodeQL alerts declined above.

## Review Comments Addressed — 2026-09-02 (round 4, PR #33)

Requested from both bots. **CodeRabbit did not review this round** — rate
limited under its fair-usage policy on three attempts, most recently 16 minutes
out. So round 4's coverage is Codex only, and that is a gap, not a clean return
from both.

### Prose reconciliation, before the round was requested (`7caedd7`)

A sweep of every comment on the changed call chain, up and down. Fourteen
contradictions, one of them a defect rather than a stale sentence: **the
`defendText` docblock had been detached from its function** — `isDefinitelyJson`
landed between the two, so the published API's contract documented a private
helper. The rest were mechanism claims the scan-based strip had outlived: the
iteration cap still credited with neutralising splices, the deleted `|$)` arm
described as live in three places, the post-processor header claiming the wrap
runs sanitise-and-detect, and a docblock referring to a `key` parameter that a
reverted edit of mine had left behind.

### Fixed

| Comment | Reviewer | Severity | Disposition |
|---|---|---|---|
| "Bound openers that borrow the closing tag's terminator" | codex | **P1** (theirs: P1) | **Fixed in `58bc175`.** Reproduced first: `"<script".repeat(30000) + "</script>"` measured **2881 ms** at 205 KB, `<style` 2460 ms; now 9 ms. `withinClosableRegion` guarantees a closer lies *ahead* of every attempt, which is not the same as the attempt being able to *reach* it — the opener's `[^>]*` crossed `<` and ate the region's only closer as its own tag terminator. Both attribute runs are now `[^<>]*`, matching `lastTagCloserEnd`'s walk. **Round 2 fixed this class on the closer and wrote down that the asymmetry was safe**, which is why nobody checked the opener: K-11, one round after RC-13 named it. RC-14 |

### Escalated in rounds 1–3, decided by the director in round 4

| Comment | Reviewer | Severity | Disposition |
|---|---|---|---|
| Reapply `max_result_size` after the outer defence pass | codex (r1) + coderabbitai (r2) | P2, in scope | **Fixed in `5698ebb`.** Director chose "plumb the cap into the wrap". Implemented as the goal rather than the location, on evidence: at the wrap the body is sealed inside `formatResponse`'s JSON envelope, and a **compliant** 1000-byte body arrives there as a **1057-byte** text part under `include_metadata` — a wrap-side cap truncates correct responses mid-JSON, and the wrap has no file to save to. `processor.ts::exceedsInlineCap` weighs the defended form and both size gates call it. RC-15 |

### Notes on the fix that are worth a reviewer's attention

- **`processResponse`'s return is unchanged.** It is a published entry point
  documented as returning the origin's grammar. The defended text is computed as
  a measurement and discarded; only the gate consumes it. An earlier attempt
  moved the strict pass into `processResponse` and broke seven contract tests —
  correctly.
- **The measurement is skipped where it cannot change the answer**, because it
  calls `sanitizeAndDetect`, which logs. Running it unconditionally silently
  converted the documented detect-on-original trade-off into a log line; the
  suite caught it. Two cheap arms answer first.
- **The first jq regression guard was toothless — the fifth on this branch.** It
  derived the cap with `JSON.stringify` while jq pretty-prints, so the assumed
  530 bytes were really 642, the result was already over cap on its own size,
  and it passed with the fix reverted. Rewritten to take the cap from a real
  uncapped call.

### Outstanding Todos

**0 filed this round.** The four in `docs/todos/` are the pre-existing backlog
and none carries `pr: "#33"`. `docs/todos/005` gained one acceptance criterion —
the class sweep RC-14 prescribes.

### Files Modified

`src/lib/response/strip-blocks.ts`, `src/lib/response/processor.ts`,
`src/lib/response/post-processor.ts`, `src/lib/tools/jq-query.ts`,
`src/lib/response/index.ts`, `src/lib.ts`, the four test files above,
`ARCHITECTURE.md`, `LESSONS.md`, `CHANGELOG.md`, `docs/custom-tools.md`,
`docs/todos/005-bracketed-label-defeats-beacon-strip.md`, and this handoff.

### Status

**No escalations remain open.** Merge authorisation is the director's, on
GitHub — nothing in this workflow merges.

## Review Comments Addressed — 2026-09-02 (round 5, PR #33)

Both bots reviewed. **11 inline findings — 2 from codex, 9 from coderabbitai.**
The round's headline is that codex found a **P1 this branch introduced and four
rounds missed**, in code the last three rounds rewrote repeatedly.

### Changes Made

| Comment | Reviewer | Severity | Category | Action taken |
|---|---|---|---|---|
| "Preserve JSON field boundaries during the outer defense" | codex | **P1** (theirs: P1) | Fix needed | **Fixed.** Reproduced before touching anything, and it is worse than reported — see below. `defendForInline` now parses a JSON document and defends each string LEAF. RC-16, invariant 16 |
| Grammar selector missing from the published example | codex | P2 (theirs: P2) | Fix needed | **Fixed.** `docs/custom-tools.md`'s recommended snippet had `contentTypeUndetermined` commented out, so the example a consumer copies does not compile against the type this release publishes. Now live, with the meaning of each arm beside it |
| Four `executeJqQuery` calls missing the required second argument | coderabbitai | P3 (theirs: Major) | Fix needed | **Fixed.** Confirmed with `tsc --noEmit`: HEAD had 16 test-file type errors against main's 12, and the 4 extra were exactly these — mine, added in round 4. Graded P3 rather than Major because nothing enforces it: there is no `typecheck` script and `tsup` does not typecheck tests, so the suite and the build were both green. Now back to main's 12 |
| Flood bodies can silently exceed `STRIP_PATH_MAX_BYTES` | coderabbitai | P2 (theirs: Trivial) | Fix needed | **Fixed**, and graded UP. Above the cap `stripBlocksFixedPoint` returns its input untouched, so an oversized flood passes by doing no work — and `">" + "<script".repeat(37449)` is 262144 bytes, the cap exactly. One character in any literal and the whole block is vacuous and green. On a branch with five toothless guards already this is not trivial. Probed: one extra byte now fails it |
| Spotlighting claim contradicts the new wrap behaviour | coderabbitai | P3 | Documentation | **Fixed.** `docs/architecture/architecture.md` line 211 said custom and schema-generated tools "never get spotlighted, because the wrapper is the only call site". Since 3.4.0 `createWrapper` spotlights every text part it defends and `generator.ts` passes the flag in. Published to npm, and this PR is what made it false |
| Persisted-JSON records overstate the exemption | coderabbitai | P3 (theirs: Major) | Documentation | **Partially fixed** — see Declined. Confirmed by measurement: `{"a":"<script>x</script>"}` served as `text/html` is persisted as `{"a":""}`. This PR narrowed the exemption (`jsonExemptionCouldApply`); on main the gate did not exist. ARCHITECTURE.md invariant 1a and CHANGELOG now state the content-type gate and what it costs |
| Invariant 15 states the linearity condition too loosely | coderabbitai | P3 | Documentation | **Fixed, but not as asked.** Their point was that "must exclude" over-claims. The real defect is the opposite: the rule as written justified `[^>]*`, which is precisely what RC-14 was. Now: exclude every delimiter still to be consumed, with partitioning as an explicit, argued exception |
| Byte-identity criterion conflicts with inline stripping | coderabbitai | P3 | Documentation | **Fixed.** `docs/todos/004`'s criterion now says PERSISTED channel and names the inline exception, so whoever picks it up is not chasing a criterion correct behaviour fails |
| Record the final grammar-selector contract | coderabbitai | P3 | Documentation | **Fixed.** The Key decisions row now records both halves — required in the type, defaulting to the STRICT arm at runtime |
| Identify the test-count snapshot | coderabbitai | P3 | Documentation | **Fixed.** 1098 is labelled as the original reading, not updated in place |

### The P1, and why it survived four rounds

`formatResponse` seals body, headers and stderr into one JSON envelope. The
strip stages pair an opening token with a closing one and have no notion of the
syntax between two fields, so an opener in `response` and a closer in `headers`
delete everything between them.

Measured before the fix:

- body `{"note":"budget <!-- draft"}` + header `x-trace: a-->b` → the returned
  envelope had **no `headers` key at all**, and the body was cut mid-value.
- `{"a":"open <!--","b":"close -->","c":"kept"}` → `{"a":"open ","c":"kept"}`.
  One document, no envelope, no headers — this is the `jq_query` shape.

**Both outputs are valid JSON.** That is why nothing downstream noticed and why
no test caught it: the guards ask whether the result parses, not whether all the
parts are still there.

**RC-15 measured this same envelope one round earlier** and asked only how big
it was. The fact was already in the ledger.

### The fix's own first version broke invariant 14

Recorded because it is the more useful half. Indenting whenever the input held a
newline re-inflates a sparsely formatted document by its nesting depth — 53
bytes in, **140 out**, against a growth ratio that believes the ceiling is 15/9 —
so `exceedsInlineCap`'s cheap arm would have reported compliance for a body
reaching the model over its cap.

**The obvious repair was worse.** Gating that arm on `isDefinitelyJson` made the
measurement run the full pass, which logs; the suite failed on a test asserting
silence. That is RC-15's own second lesson arriving from the opposite direction
one round later. What holds needs no constant: indent only where indenting does
not grow the document.

### Declined Findings

| Comment | Reviewer | Severity | Scope call | Reason declined |
|---|---|---|---|---|
| Correct RC-8 and RC-10 in `LESSONS.md` to match the strip path | coderabbitai | P3 | In scope | `LESSONS.md` is an append-only ledger and an RC is durable once assigned — `.claude/rules/03-divergence.md`. Retro-editing a past RC to reflect later knowledge destroys the record of what was known when. The correction belongs in a NEW entry, and it is in invariant 1a and the CHANGELOG where a reader meets the rule rather than its history |
| Renumber the invariant list so markdownlint MD029 passes | coderabbitai | P3 | In scope | The `1a` entry is deliberate and every invariant is cited BY NUMBER across `LESSONS.md`, the rules files, the source docblocks and four rounds of PR replies. Renumbering to satisfy a linter that is not in this project's pipeline would silently invalidate every one of those citations — K-7, for a warning with no consequence |

### Outstanding Todos

**0 filed this round.** The four in `docs/todos/` are pre-existing backlog and
none carries `pr: "#33"`. `docs/todos/004` gained a scoping clause.

**One open question is recorded, not filed:** a remote-declared content type
decides whether a persisted artefact is altered (invariant 1a). Both directions
have a cost and the bypass is the worse one, so it is documented where the rule
is stated rather than promised as work.

### Files Modified

`src/lib/response/processor.ts`, `post-processor.ts`, and the three test files
`post-processor.test.ts`, `processor.test.ts`, `strip-blocks.test.ts`,
`src/lib/tools/jq-query.test.ts`, `ARCHITECTURE.md`, `LESSONS.md`,
`CHANGELOG.md`, `docs/architecture/architecture.md`, `docs/custom-tools.md`,
`docs/todos/004-…md`, `dist/` (rebuilt), and this handoff.

### Testing summary — round 5

**1158 passed, 7 skipped, 32 files.** `npx tsc --noEmit`: **12 errors, exactly
main's count and locations** — the 4 this branch added are gone. Build exits 0.

**Teeth verified against four source mutations**, each backed up with `cp` and
restored from the copy (`diff` confirmed byte-identical):

| Mutation | Tests that failed |
|---|---|
| `defendForInline` back to scanning the serialised form | 4 of the 6 new invariant-16 cases. The other two are labelled positive controls and pass either way, by design |
| `defendForInline` always indents | the RC-16-meets-RC-15 growth guard |
| `defendForInline` always compacts | the pretty-preservation guard |
| one extra byte in a flood literal | that flood case, on the new cap assertion |
