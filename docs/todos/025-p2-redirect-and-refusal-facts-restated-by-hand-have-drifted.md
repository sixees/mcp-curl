---
status: complete
effort: m
tags: [code-review, docs, tool-description, schema, redirects, refusals, documentation-resource, k-8]
dependencies: []
---

# Redirect and refusal policy re-spelled by hand in published prose, with no pin to its code owner; copies have already drifted

## Problem Statement

The redirect policy (followed statuses, method table, cross-origin header set, `max_redirects` default), the header cap and the local-refusal shape each have one code owner. 5.2.0 restates them by hand in the schema `.describe()` text, the `curl://docs/api` resource, `docs/configuration.md`, the README and the CHANGELOG. Two of those copies are read by the model. Nothing ties any copy to its constant, and several copies already disagree with the code or with each other.

**Escalated P3 → P2.** In this review, learnings-researcher matched RC-36 on `Class: broken-contract`, which is an alias of this class. RC-36's subject is the MINOR-versus-MAJOR price rather than prose drift, so this join is weaker than a slug match; the escalation follows the review's never-lower rule.

## Findings

- class: a closed set or policy owned by one constant is copied out by hand into model-facing and operator-facing prose; nothing derives or tests the copies against the constant, so a copy can disagree with the code and nothing fails.
- aliases: `convention-drift` (architecture-strategist), `broken-contract` (security-sentinel). Merged on the shared confirmed instances `src/lib/server/schemas.ts::CurlExecuteSchema`, `src/lib/resources/documentation.ts::registerDocumentationResource` and `docs/configuration.md` → *Local refusals*.
- failure:
  - The README says a cross-origin hop keeps "the `Accept*` and `User-Agent` headers". `CROSS_ORIGIN_FORWARDED_HEADERS` keeps only `accept`, `accept-language` and `accept-encoding` (plus `user-agent`), so `Accept-Charset` is dropped while the README says it is kept.
  - The *Local refusals* table gives the `Retry in N s.` suffix to `LOCAL_RATE_LIMITED` only. `formatLocalRefusal` also appends it to a `LOCAL_REDIRECT_REFUSED` whose reason is `rate-limited`. The table, the CHANGELOG and the prose also say the first line is followed by "one sentence", which is false whenever the suffix is added.
  - *Local refusals* says every request refused before sending takes the `Refused locally…` first line. A first-request SSRF/DNS refusal, or a malformed `basic_auth`, returns `Error executing cURL request: …`. The CHANGELOG *Notes* scope this correctly; the docs and README drop the scoping.
  - The same section says `curl_execute`'s stderr line carries the refusal code. A `LOCAL_REFUSED_PATH` from `curl_execute` is returned by `tool-wrapper.ts::registerCurlToolWithHooks` before `executeCurlRequest` runs, so nothing is logged.
  - The documentation resource's `follow_redirects` row omits that 307/308 keep the method and body, that a refused hop says how many requests were sent, and that any other 3xx is returned as is. The plan required that row to match the schema (K-8).
  - `include_headers` restates "64KB" and the description restates "10MB" as literals, while `config/limits.ts` asks to cite the constant because four documents were already wrong about 64KB.
  - The documentation resource's "as a leading `[mcp-curl]` notice otherwise" reads like the old prefix form (RC-46) — suspected, not confirmed in diff.
- instances:
  - `README.md` → Security, "Per-hop redirects" and "Local refusals" bullets — confirmed, drifted
  - `docs/configuration.md` → *Local refusals* (retry suffix, "one sentence", universality, stderr line) — confirmed, drifted
  - `CHANGELOG.md` → `[5.2.0]` *Added*, "followed by one sentence naming the reason" — confirmed, drifted (history)
  - `docs/configuration.md` → *defaultHeaders*, cross-origin set without the body headers — confirmed, partial
  - `src/lib/resources/documentation.ts::registerDocumentationResource`, the `follow_redirects`, `max_redirects` and `include_headers` rows — confirmed, partial copy
  - `src/lib/server/schemas.ts::CurlExecuteSchema`, the `follow_redirects`, `max_redirects` and `include_headers` describes — confirmed, match today; the copy to keep
  - `src/lib/tools/curl-execute.ts::CURL_EXECUTE_TOOL_META`, "Above 10MB" literal — confirmed
  - `docs/configuration.md` → *allowedHosts*, the per-hop and cross-origin bullets — confirmed, match today
  - `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks`, no stderr line for `LOCAL_REFUSED_PATH` — confirmed, out of diff (the code side the stderr sentence misdescribes)
- sweep, as each reviewer ran it:
  - pattern-recognition-specialist: `rg -n -i "accept|cross-origin|303|307|max_redirects|LOCAL_[A-Z_]+|Retry in|one sentence|64 ?KB"` over README.md, docs/*.md, docs/architecture/architecture.md, documentation.ts, schemas.ts, public.ts and the CHANGELOG diff — 10 candidates → 7 confirmed.
  - code-simplicity-reviewer: `303|307|Accept-Language|LOCAL_REDIRECT_REFUSED|final hop|headers_unsupported` excluding dist, node_modules and work dirs — 6 prose files → 2 model-facing copies confirmed.
  - architecture-strategist: `64KB|64 KB|65_536|MAX_HEADER` over src/lib, `Accept-Language|accept-language` over src/ and docs, `10MB` — 7 model-facing candidates → 4 confirmed, 1 suspected.
  - security-sentinel: `rg -n "LOCAL_REFUSED_PATH|curl_execute error" src/lib -g '!*.test.ts'` — 6 hits; only `curl-execute.ts` writes the stderr line.
- root: source. The facts live in `tools/redirect-hop.ts`, `utils/error.ts` and `config/limits.ts`, and every prose site copies them by hand.
- Found by: pattern-recognition-specialist, code-simplicity-reviewer, architecture-strategist and security-sentinel, Surface 2 review, 2026-10-29.

## Proposed Solutions

### Option 1: Correct the drifted copies, and cut the second model-facing copy
Fix the README header list and refusal scoping, the *Local refusals* table (retry suffix on any `rate-limited` reason; drop "one sentence"; scope to the four codes; correct the stderr sentence), and the CHANGELOG wording before release. Cut the documentation resource's per-parameter rows back to a one-clause summary that defers to the input schema.
- Pros: one model-facing owner per fact; small.
- Cons: the schema describes can still drift from the constants.
- Effort: s. Risk: low.

### Option 2: Option 1, plus derive or pin the model-facing strings
Interpolate `LIMITS.MAX_HEADER_TEXT_BYTES` and `LIMITS.MAX_RESPONSE_SIZE`; render the status and header sets from their constants (moving them to `config/` so `server/` need not import `tools/`), or add a test that each describe names every member.
- Pros: the next change to a constant cannot leave the model misinformed.
- Cons: moves constants across layers; more change than a release slice wants.
- Effort: m. Risk: low.

## Recommended Action

Option 1, chosen by the operator on 2026-10-29 ("Fix 025+026, then ready PR"): correct the drifted copies and cut the documentation resource's second copy. Option 2 (interpolating constants, moving the sets to `config/`, a pin test) was not taken; the literal "64KB"/"10MB" in the schema and description remain.

## Acceptance Criteria

- [x] The README and `docs/configuration.md` name the exact forwarded headers, and scope the refusal shape and the stderr line to where the code applies them.
- [x] The *Local refusals* table says which refusals carry `Retry in N s.`.
- [x] Exactly one model-facing surface states each per-parameter redirect and header fact, or a test pins each copy to its constant.
- [x] Re-running the sweeps above finds no drifted copy.

## Work Log

### 2026-10-29 - Filed from Surface 2 review
**By:** Claude Code
**Actions:** merged four reviewers' classes on shared confirmed instances; escalated P3→P2 on the RC-36 alias join.
**Learnings:** the plan's own K-8 instruction for the documentation row was unmet on the day the row was written.

### 2026-10-29 - Resolved on docs/release-5.2.0
**By:** Claude Code
**Actions:** commit `1d846a1`. `README.md` Security bullets, `docs/configuration.md` → *defaultHeaders* and *Local refusals*, the `CHANGELOG.md` `[5.2.0]` *Added* entry, and `src/lib/resources/documentation.ts::registerDocumentationResource` (rows now defer to the input schema; the notice is no longer "leading"). Re-ran the sweep for `Accept*`, "one sentence", "leading [mcp-curl]" and `Retry in`: no drifted copy remains. `npm test`: 1766 passed, 0 failed.
**Learnings:** the schema describes remain the one model-facing copy; nothing pins them to `CROSS_ORIGIN_FORWARDED_HEADERS` or `FOLLOWED_REDIRECT_STATUSES` (option 2, not taken).
