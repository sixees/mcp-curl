---
status: pending
severity: medium
effort: s
tags: [code-review, documentation, response, jq-query, public-api, stale-comment]
dependencies: []
pr: ""
---

# Prose still describes the JSON rewrite this branch removed, or says the wrap, the built-in tools and defendText run one pipeline

## Problem Statement

The branch updated the sentence beside each changed line but left paragraphs, docblocks, describe-block headers and published docs that still say JSON is sanitised or that `defendText` is what the built-in tools run. Some sit directly above code that now contradicts them; some are published (`docs/custom-tools.md` states both contracts a few lines apart — K-8). A later reviewer trusting them reverses RC-49; a custom-tool author trusting them skips stripping bidi characters the wrap no longer removes.

## Findings

**Instances:**
In-diff, confirmed:
- `docs/custom-tools.md` — *Composing the Full Defence*: "Sanitise-and-detect … still runs on every layer including JSON"; step 1 wording; *Response Sanitization* "same function the built-in tools call" / "replicate … call `defendText`"
- `docs/architecture/architecture.md` — *Stage notes* "Sanitize + detect" as a body-path stage; *Prompt Injection Defense* line anchors
- `src/lib/response/processor.ts::processResponse` — save-arm "Anything else is persisted as the DEFENDED text"; Step 7 "weighs the DEFENDED bytes"; jq branch "Same reviver as the defence walk above"; filter-gate "composite only" clause; docblock step 2 overclaim (sanitised copy is also persisted when unusable)
- `src/lib/response/processor.ts::savedMessage` — `SavedMessageFacts` docblock on the defence pass
- `src/lib/response/processor.ts::exceedsInlineCap` — "calls `sanitizeAndDetect`, which logs"
- `src/lib/response/processor.ts::BodyClassification` — "only arm … persisted as the origin sent them"
- `src/lib/response/post-processor.ts::createWrapper` — "text parts have been sanitised"
- `src/lib/response/processor.test.ts` — "JSON arm sanitises and returns"; "post-jq sanitisation runs …" describe title
- `src/lib/response/post-processor.test.ts` — "What still runs is Step 2"; idempotence proxy comment
- `src/lib/tools/jq-query.test.ts` — invariant-14 describe header; JSON-grammar block comment; "(sanitized) filtered output"
- `src/lib/tools/register-all-tools.test.ts` — over-cap "once the inline defence pass" rationale comments
- `src/lib/tools/curl-execute.json-passthrough.test.ts` — 600 KB object case comment on the replaced rule

Out of diff (siblings, confirmed): `src/lib.ts` header + section 7 ("same pipeline", "what the built-in tools run"); `src/lib/schema/generator.ts::createToolHandler`; `docs/hooks.md` short-circuit paragraph.

Suspected: `docs/custom-tools.md` and `CHANGELOG.md` "at any layer" vs the published `defendText` (operator's call); `processor.ts::JsonRejectionReason` and `emptyBody` stacked paragraphs.

**Sweep:** union of four reviewers' sweeps (e.g. `rg -n -i 'json[^\n]{0,80}sanitis|sanitis[^\n]{0,80}json|same pipeline|what the built-in tools run|Step 2 alone|JSON grammar|inline defence pass|persisted as the DEFENDED|including JSON'` over `src docs README.md`) → ~60 candidates → 20 confirmed, 3 suspected; the original builder sweep missed these spellings.

**Fix (class level):** state the JSON-arm contract once in `docs/custom-tools.md` → *Composing the Full Defence* (including that `defendText` with defaults still sanitises JSON, so it does not reproduce the server's JSON arm), and make `src/lib.ts`, `generator.ts`, `hooks.md` cite it; rewrite each in-code block to describe HEAD.

## Proposed Solutions

### Option 1: Rewrite every listed site now
**Pros:** no false claim survives. **Cons:** broad prose diff. **Risk:** Low.

### Option 2: Fix published and in-diff sites; leave out-of-diff source comments for `/sixees-workflow:sync-comments`
**Pros:** smaller. **Cons:** `src/lib.ts` is a published-API comment. **Risk:** Low.

## Recommended Action

_Not yet dispositioned — filed `pending` by review._

## Acceptance Criteria

- [ ] The sweep above returns no false claim in `src/`, `docs/` or `README.md`
- [ ] `docs/custom-tools.md` states the JSON contract once; siblings point at it
- [ ] The idempotence test's proxy cannot go false-green on a JSON fixture

## Work Log

### 2026-10-20 - Filed by Surface 2 review

**By:** Claude Code (`/sixees-workflow:review` on `fix/019-json-arm-detects-without-rewriting`)

**Actions:** reviewers code-simplicity-reviewer, security-sentinel, pattern-recognition-specialist, architecture-strategist, typescript-reviewer (P3 single instance merged) reported the class; the orchestrator re-ran the sweep.

**Learnings:** introduced or exposed by the 019 branch (base `cd006ba`, commits `1cedbc0`, `01574b4`).

## Resources

- Branch `fix/019-json-arm-detects-without-rewriting`; `docs/todos/019`; `.sixees/LESSONS.md` RC-49.
