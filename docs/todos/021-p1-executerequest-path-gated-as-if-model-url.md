---
status: pending
severity: high
effort: s
tags: [code-review, broken-contract, extensible, instance-utilities, url-resolution, published-api, invariant-11]
dependencies: []
---

# A check written for a model-typed url is applied to `path`, so published `path` values that used to join are refused

## Problem Statement

`utilities().executeRequest({ path })` is a published method (invariant 11). At base
`8edf9e7` its `path` branch joined unconditionally with `resolveBaseUrl`, so every
`path` reached the configured host. On `feat/embedder-base-url` the `path` branch
turns `path` into a `url` and sends it through `resolveRequestUrl`, whose
`RELATIVE_PATH_PATTERN` gate (`^/` but not `//` or `/\`) exists to tell a
model-typed **path** from a model-typed **scheme-relative host**. For `path` that
question is already settled — it is always appended to the base and never parsed
on its own — so the gate only refuses inputs that used to work.

Failing case: `configure({ baseUrl: "https://api.example.com" })` then
`utilities().executeRequest({ path: "//users" })`. Base: request to
`https://api.example.com//users`. HEAD: `"//users"` fails the pattern, passes
through unresolved, and `validateUrlAndResolveDns` rejects it as
`Invalid URL format` → `isError`. Same for `path: "\\x"` (becomes `/\x`) and
`path: "/\\x"`. All three stayed on the base host under the old join (verified
with `new URL` on the concatenation).

**Recurrence.** Class `broken-contract` is recorded in `LESSONS.md` RC-36, RC-21,
RC-20 and RC-55; RC-55 is the nearest shape — an extraction that loosened (here,
narrowed) the contract at the one seam every caller funnels through.
**Builder acknowledged:** the work run named this exact behaviour change in commit
`ffae802`'s body ("A path beginning // is no longer joined") and the operator's
audit decision kept leading-slash tolerance for `path` without addressing `//`.

## Findings

- class: a check written for one kind of input (a model-typed url, which might
  be a host) is applied to a field whose meaning is already certain (a path).
- instances:
  - `src/lib/extensible/instance-utilities.ts::createInstanceUtilities` — the
    `executeRequest` `path` branch routes `path` through `resolveRequestUrl` — confirmed
  - (not instances — the gate is correct there: `src/lib/extensible/tool-wrapper.ts::registerCurlToolWithHooks`
    and `src/lib/server/schemas.ts::CurlExecuteBaseUrlSchema`, both model-typed `url`)
- sweep: `rg -n 'resolveRequestUrl|RELATIVE_PATH_PATTERN|params\.path' src -g '!*.test.ts'`
  → 3 call sites → 1 confirmed. `rg -n 'path: "(//|/\\\\)' src` → 0 tests cover this input.
  Re-run by the orchestrator: reproduced.
- Reviewer: architecture-strategist (P1, confidence medium). security-sentinel and
  typescript-reviewer each noted the same behaviour change out of lane.

## Proposed Solutions

### Option 1: split the join from the gate (reviewer's fix)

**Approach:** `url.ts` exports the join step (`resolveBaseUrl` + the base-parse /
scheme check + the `{ ok: false }` refusal). `resolveRequestUrl` becomes the
`RELATIVE_PATH_PATTERN` gate followed by that join. The `executeRequest` `path`
branch calls the join step directly.
**Pros:** one join, one refusal; restores base behaviour for every `path`.
**Cons:** a second exported function in `utils/url.ts`.
**Effort:** s · **Risk:** low

### Option 2: accept the narrowing and document it

**Approach:** keep HEAD behaviour; add a CHANGELOG line and a `docs/configuration.md`
sentence. Price under invariant 11 — a narrowing of a published method is MAJOR.
**Pros:** no code change.
**Cons:** contradicts the plan's MINOR (5.1.0) pricing.
**Effort:** s · **Risk:** medium (version semantics)

## Recommended Action

_Unfilled — needs the operator's call._

## Technical Details

- `src/lib/extensible/instance-utilities.ts::createInstanceUtilities`
- `src/lib/utils/url.ts::resolveRequestUrl`, `::RELATIVE_PATH_PATTERN`
- Test site: `src/lib/extensible/mcp-curl-server.test.ts` → "executeRequest with path and baseUrl"

## Resources

- Plan: `docs/plans/2026-10-20-feat-embedder-persona-gaps-plan.md` → *Item 1*, PR-1
- `.sixees/ARCHITECTURE.md` → *Invariants* 11
- `.sixees/LESSONS.md` RC-36, RC-55

## Acceptance Criteria

- [ ] `executeRequest({ path: "//users" })` on a `baseUrl` server reaches `<baseUrl>//users`
      (observable through the SSRF refusal on `http://127.0.0.1`, as the existing utilities tests do)
- [ ] `executeRequest({ url: "//users" })` is still not joined (gate holds for `url`)
- [ ] Teeth: routing `path` back through the gate fails the new test

## Work Log

### 2026-10-20 - Filed by /sixees-workflow:review (Surface 2)

**By:** Claude Code
**Actions:** Dispositioned in scope (confirmed instance in diff `8edf9e7..HEAD`).
Sweep re-run and reproduced; base behaviour checked with `git show 8edf9e7:src/lib/extensible/instance-utilities.ts`.
**Learnings:** the K-20 duty enumeration in the work loop listed "adds a missing
leading slash" for `path` but not "joins any path, `//`-led included".
