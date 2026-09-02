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

The wrap now runs the full pipeline. A module-private `DEFENDED` tag keeps that
from double-processing text `curl_execute` and `jq_query` already defended under
a real Content-Type. `defendText` became a public export, because the published
guidance for non-MCP consumers pointed at Step 2 and called it the whole thing.

## What was implemented

### The defence (`src/lib/response/post-processor.ts`)

`processTextPart` calls `defendText(text, { hostname, contentTypeUndetermined:
true, decodeEntities: false })` for untagged results. `contentTypeUndetermined`
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
| Exclude `[` from the beacon label class rather than capping it | The docblock records that a 256-char cap was removed *because* padding past it defeated all four patterns. A cap is a settled reversal. Excluding `[` partitions the input, so the pass is linear by construction, not merely faster. | Cap the label (rejected: reinstates a known bypass); linear left-to-right scan (larger rewrite, and todo 005 will need it) |
| Bound the block scan to the region a `>` closes | Provably equivalent — every pattern ends at a literal `>`, so no match can begin past the last one. Only possible once the `|$)` arm was gone. | Exclude `<` from the attribute run (rejected: `<script foo="<">` bypasses); cap the run (same settled reversal) |
| Neutralise an orphan opener instead of deleting to EOF | CodeQL's rule is about the residual TOKEN, which removal satisfies. Deleting the caller's payload was never the requirement. | Keep the arm and add a byte-count notice (see below) |
| **Declined:** the `[mcp-curl] N bytes removed` notice | You approved it alongside the P1-B fix, and its justification was the *silent unbounded* loss. That loss is gone — every remaining removal is a bounded substitution that announces itself (`[link removed]`) or leaves the body visible. A byte counter on every stripped response would be noise. Flagging rather than burying, since you asked for it. | Add it anyway |
| **Reverted:** the RC-3 scratch-copy decode | Built it; the commit rule cannot serve both channels. See RC-12 and todo 004. The half that is unambiguous — never entity-decode a JSON document — did land. | Ship the naive version (loses the detector and the sanitiser on masked payloads) |
| `contentTypeUndetermined` becomes required | Absence resolved to the permissive arm on a type this release publishes. Not breaking: the type is new in 3.4.0. | Discriminated union (larger, same effect); leave it and document (the doc snippet I wrote had the unsafe arm uncommented) |
| Bump to 3.4.0 | Additive export, no breaking change. | Major (nothing removed) |

## What to pay attention to during review

- **`markDefended` is the one thing here that can weaken a defence.** Every
  other change adds. Check both call sites against the claim in its docblock,
  and check that neither error return acquired it.
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

- **Suite: 1098 passed, 7 skipped, 32 files.** `npm test` (vitest). Build exits
  0. `npx tsc --noEmit`: **0 errors in non-test files**; 12 pre-existing test-file
  errors, unchanged in count and location.
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
