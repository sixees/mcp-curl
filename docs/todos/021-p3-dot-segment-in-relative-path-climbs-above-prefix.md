---
status: complete
severity: low
effort: m
tags: [url-resolution, utils, extensible, instance-utilities, custom-tools, docs]
dependencies: []
---

# A dot-segment in a relative path resolves above the prefix the embedder built

## Problem Statement

`utilities().executeRequest` joins a relative `url` or `path` onto `baseUrl` by
concatenation (`src/lib/utils/url.ts::resolveRequestUrl` → `::resolveBaseUrl`). The
resulting string keeps any `.` or `..` segment. Both the SSRF gate's WHATWG parse and
cURL then resolve it: nothing in `src` passes `--path-as-is`. So an embedder that
builds `` `/users/${encodeURIComponent(id)}` `` from a model-chosen `id` requests the
API root when `id` is `".."`, sending the configured `defaultHeaders` with it.

`encodeURIComponent` does not help, because it leaves `.` unchanged. WHATWG also
treats `%2e%2e` as `..`: `new URL("https://api.example.com/users/%2e%2e").href` is
`https://api.example.com/`.

The host never changes, so the SSRF boundary holds. The exposure is a scoped call
reaching a sibling or parent endpoint on the same authenticated API.

**Population:** every team embedder that interpolates a model-chosen value into a
`url` or `path` segment. The reference wrapper does this. The documented example
(`docs/custom-tools.md` → *Using Instance Utilities*, `get_user_profile`) was fixed in
place by constraining the id in its `inputSchema`. This todo is about the library,
where the fix would cover every embedder rather than only those who copy the example.

## Findings

- Found by the `/sixees-workflow:sync-comments --branch` audit of `feat/embedder-base-url`
  (class C, p3): the example's comment claimed encoding prevents path traversal.
- `src/lib/utils/url.ts::RELATIVE_PATH_PATTERN` refuses `//`, `/\`, a leading `\` and
  control characters. It has no dot-segment rule.
- On the `curl_execute` tool path the model writes the whole `url`, and an absolute URL
  to any host passes (declined in the plan, operator Q1). A dot-segment rule there would
  add nothing that an absolute URL does not already allow.
- Measured (node 24): `/users/..`, `/v1/users/..` and `/users/%2e%2e` all resolve to
  the parent path.

## Proposed Solutions

### Option 1: refuse dot-segments in a relative path

**Approach:** extend `RELATIVE_PATH_PATTERN`, or add a check in `resolveRequestUrl`,
to refuse any segment equal to `.` or `..` in any case or percent-encoding
(`%2e`, `%2E`), in the path part only, before the query.
**Pros:** covers every embedder; it is one rule in one place.
**Cons:** narrows `executeRequest` again (the CHANGELOG would need a line), and the
encoded-dot cases need careful tests.
**Effort:** m · **Risk:** low

### Option 2: send the path as-is

**Approach:** pass `--path-as-is` to cURL so it does not collapse dot-segments.
**Pros:** no input narrowing.
**Cons:** the SSRF gate's WHATWG parse would still normalise, so the URL checked and
the URL sent would differ, which is the mismatch `RELATIVE_PATH_PATTERN` exists to
avoid. The API server may normalise anyway. Not recommended.
**Effort:** s · **Risk:** medium

### Option 3: documentation only

**Approach:** keep the warning in `docs/custom-tools.md` and leave input constraint to
each embedder's schema.
**Pros:** no code change.
**Cons:** relies on every embedder reading it.
**Effort:** none · **Risk:** depends on the embedders

## Recommended Action

Option 1, extended to YAML path parameters (operator, 2026-10-21: "fail loudly if the
path contains those"). One rule, `src/lib/utils/url.ts::hasDotSegment`: split the
part before `?`/`#` on `/` and `\`, and refuse any segment matching
`/^(?:\.|%2e){1,2}$/i`. It is called from `resolveRequestUrl`, which covers
`executeRequest` and the `curl_execute` tool path, and from
`schema/generator.ts::buildUrl`, which covers YAML path params.

Not covered, by decision:
- An absolute `curl_execute` url: it names its own path, so it has no prefix to climb
  out of.
- `%252e`, `..;` and similar: these depend on how the server decodes the path, which
  mcp-curl cannot see.

## Technical Details

- `src/lib/utils/url.ts::resolveRequestUrl`, `::RELATIVE_PATH_PATTERN`, `::resolveBaseUrl`
- `src/lib/extensible/instance-utilities.ts::createInstanceUtilities`
- `src/lib/server/schemas.ts::CurlExecuteBaseUrlSchema` shares the pattern, so extending
  `RELATIVE_PATH_PATTERN` would change the advertised tool schema; the check chosen
  (`hasDotSegment`, called from `resolveRequestUrl`) leaves the schema unchanged.

## Acceptance Criteria

- [x] `executeRequest({ path: "/users/.." })`, `"/users/%2e%2e"` and `"/users/%2E."`
      on a `baseUrl` server do not reach the parent path (or the decision not to fix is
      recorded here)
- [x] `"/users/a..b"` and `"/users/.hidden"` still resolve (positive control: `/a..b`,
      `/.well-known/…`, `/v1.2/x`, and dots in the query or fragment)
- [x] Teeth: removing the rule fails the named test (probed per arm and per call site)

## Work Log

### 2026-10-21 - Filed from the comment-sync audit

**By:** Claude Code
**Actions:** Measured dot-segment resolution with `new URL`. Confirmed `rg -n path-as-is src`
finds nothing. Fixed the `get_user_profile` example in `docs/custom-tools.md` (id
constrained by `inputSchema` regex, warning paragraph added).
**Learnings:** WHATWG treats `%2e%2e` as `..`, so a check that matches only literal dots
misses it.

### 2026-10-21 - Resolved

**By:** Claude Code
**Actions:** Added `utils/url.ts::hasDotSegment`. It is called from `resolveRequestUrl`
and from `schema/generator.ts::buildUrl`, where a module-private `DotSegmentError` is
turned into an error result by `createToolHandler`. Tests cover `url.test.ts`, the
`utilities()` cases, the e2e tool path, and `schema.test.ts` (`buildUrl` and the
handler). Updated docs: `CHANGELOG.md` (BREAKING), `docs/configuration.md`,
`docs/custom-tools.md`, `docs/api-schema.md`.
**Learnings:** the first set of query/fragment negatives (`?next=../x`, `#..`) never
formed a `/`-delimited segment, so they passed with the exclusion deleted. Negatives
need a `/../` inside the query to test it.
