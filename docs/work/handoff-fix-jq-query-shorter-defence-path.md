# Work Handoff: Route every undefended tool channel through defendText

**Date:** 2026-09-02 | **Branch:** `fix/defend-undefended-tool-output` | **Plan:** `docs/todos/001-jq-query-shorter-defence-path.md` (removed; see *Resolved Todos*) | **Status:** complete

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

### The `DEFENDED` tag (same file, `markDefended()` exported)

Module-private `Symbol()`, mirroring the existing `WRAPPED` tag and reusing its
hostile-Proxy probe — `hasOwnWrappedTag` was generalised to `hasOwnTag(result,
key)` and `tag()` to `setTag(result, key)` rather than copied.

The tag asserts: *this result's text needs no strip stages, because every part
of it is either server-authored or already took `defendText` under the content
type the origin declared.* Claimed by `curl_execute`'s and `jq_query`'s **success**
returns only. Both **error** returns keep the untagged default — that text is
assembled from exception messages, and `applyJqFilter`'s invalid-JSON error
quotes a preview of the file it was reading.

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
| Fix the wrap, decline the `jq_query` half | `jq_query` can only return JSON, and `defendText` on JSON *is* what it already ran. The gap was JSON-vs-everything, not this tool. | Strip inside JSON string values everywhere (bigger, touches the primary tool, and governs bytes `save_to_file` persists); document and close nothing (leaves the live instance open) |
| A `DEFENDED` tag rather than accepting the double-pass | Without it the defence a body gets depends on `include_metadata`: with it true the body sits in a JSON envelope the strictest grammar excludes, with it false it does not. Two defences for the same bytes, chosen by an output-format flag. | Accept the behaviour change (would newly rewrite markdown syntax in every `text/plain` and `text/html` body); thread the Content-Type through the wrap (changes a four-call-site contract) |
| **Did not** widen `isDefinitelyJson` to all JSON roots | Agreed in the kickoff, then dropped — see RC-9. It would have added a bypass spelling on the body path, and tagging `jq_query` reaches the same coherence without it. | Widen it as planned |
| `decodeEntities: false` at the wrap | RC-3, and here it also corrupts JSON: `'"a &#x22;q&#x22; b"'` decodes to `'"a "q" b"'`, which no longer parses. Measured. | Leave the default |
| Bump to 3.4.0 | Additive public export, no breaking change. The changelog carries no BREAKING heading, so `release-guards.test.ts` is satisfied. | Patch (wrong — new export); major (nothing removed) |

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

- **Added 25 tests**, at the outermost boundary each real input reaches:
  - `mcp-curl-server.test.ts` — a `registerCustomTool()` handler's return
    through `registerToolsOnServer` and the real wrap: beacon, script block and
    markup comment stripped; two positive controls (legitimate prose and a JSON
    document both byte-identical).
  - `curl-execute.headers.test.ts` — `executeCurlRequest` through the wrap on
    both `include_metadata` branches, asserting they agree; plus a
    `text/markdown` case proving the tag defers rather than disables.
  - `jq-query.test.ts` — the declined behaviour pinned, naming RC-8, with a
    Unicode-sanitisation test as its teeth and an error-path test showing the
    untagged error result IS fully defended.
  - `post-processor.test.ts` — unit coverage of both arms, the forged
    `Symbol.for("mcp-curl.defended")` closure, and the spread-loses-the-tag
    fail-safe direction.
- **Suite: 1091 passed, 7 skipped, 32 files.** `npm test` (vitest).
- **Build:** `npm run build` exits 0, DTS included.
- **Types:** `npx tsc --noEmit` — **0 errors in non-test files.** 12 pre-existing
  errors remain in test files (`schema.test.ts`, `lib.test.ts:78`,
  `post-processor.test.ts` deliberate malformed-input casts); none introduced
  here, all in files whose type errors predate this branch.
- **Teeth verified against five source mutations**, each backed up with `cp` and
  restored from the copy before staging (`diff` confirmed byte-identical):

  | Mutation | Named tests that failed |
  |---|---|
  | `processTextPart` reverts to `sanitizeAndDetect` | 9 — every strip assertion, unit and end-to-end |
  | `decodeEntities: false` → `true` | 1 — *does NOT decode numeric HTML entities (RC-3)* |
  | `alreadyDefended` forced `false` | 2 — both tag-deference tests |
  | `jq_query` stops tagging | 1 — *the wrap does not strip it either* |
  | `curl_execute` stops tagging | 1 — *keeps markdown syntax… (include_metadata: false)* |

  The last one failing on the `false` branch **only** is the D3 incoherence made
  visible: with `include_metadata: true` the JSON envelope hides the difference.

- **Verification mode:** vitest has no trustworthy structured reporter per
  `/work` §5, so this verdict is the human-readable summary above and the
  per-mutation failures were read by name. **Not a machine-parsed artefact.**
- **Gaps:** no test drives the YAML `createToolHandler` path through the new
  wrap behaviour; it shares the closure with the custom-tool path, which is
  covered, but the wiring is asserted only for custom tools.

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

No POST-AUDIT annotation was added to a plan file: the input was a todo, and it
is removed by the todo lifecycle below rather than annotated.

## Follow-up work

- [ ] Decide whether markdown beacons inside JSON string values should be
      stripped for model-facing text while `save_to_file` persists the original.
      Declined here (RC-8) — recorded as a decision, not a todo.
- [ ] `docs/architecture/architecture.md` §59 and the mermaid diagram at §107
      still describe the jq_query and wrap steps as "sanitize + injection-detect".
      Still true in effect for jq_query; imprecise for the wrap.

### Outstanding Todos

| File | Priority | Description | Source |
|---|---|---|---|
| `docs/todos/002-header-channel-should-not-be-multiplexed.md` | P1 | `-i` multiplexing; the boundary arithmetic has failed three times. `-D <tempfile>` is the move. | PR #32 review round 3 |
| `docs/todos/003-memory-ceiling-released-before-peak.md` | P2 | Pre-existing. | PR #32 review |

Neither was opened by this run, and this run opened none of its own — the branch
is net-neutral on its own todos and net-negative overall (001 removed).

### Resolved Todos

| File (removed) | Title | Summary | By | Date |
|---|---|---|---|---|
| `docs/todos/001-jq-query-shorter-defence-path.md` | Two text channels still take a shorter defence path than defendText | One instance fixed at the shared layer (`processTextPart` → full `defendText`); one refuted and declined with evidence (`jq_query` was never on a shorter path). Recommended remedy found inert. See RC-7, RC-8. | `/sixees-workflow:work` | 2026-09-02 |
