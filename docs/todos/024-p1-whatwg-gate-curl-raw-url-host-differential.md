---
status: pending
severity: high
effort: s
tags: [code-review, security, ssrf, host-policy, tools, execution]
dependencies: []
pr: ""
---

# A security gate decides on the WHATWG parse of a URL, then hands cURL the raw string, which cURL parses to a different host

## Problem Statement

`executeCurlRequest` checks the host list (and the SSRF gate resolves and pins) on `new URL(params.url).hostname`, then `buildCurlArgs` pushes the **raw** `params.url` into argv. WHATWG and cURL split the authority differently on a backslash before `@`: `http://allowed.test\@evil.test/` is host `allowed.test` to WHATWG and host `evil.test` (userinfo `allowed.test\`) to cURL. The request goes to the unlisted host, unpinned and un-SSRF-checked, carrying `defaultHeaders`. This defeats the guarantee PR-1 adds ("a host off the list is never resolved, let alone sent the credentials in defaultHeaders").

## Findings

- Instances:
  - `src/lib/tools/curl-execute.ts::executeCurlRequest` — gates on `safeHostname(params.url, "")`, forwards raw `params.url` to `buildCurlArgs` — confirmed (in diff)
  - `src/lib/execution/curl-args-builder.ts::buildCurlArgs` — `args.push(params.url)`, the sink — confirmed (unchanged code; the only route the gate's decision reaches cURL)
- Sweep: `rg -n "executeCurlRequest\b" src --glob '!*.test.ts'` → 4 routes, all funnel into the one executor; `rg -n "url|resolve" src/lib/execution/curl-args-builder.ts` → 1 URL sink. 2 candidates → 2 confirmed.
- Reproduced by the orchestrator: `new URL("http://allowed.example\\@evil.example/").hostname` → `allowed.example`, `.href` → `http://allowed.example/@evil.example/`; `CurlExecuteSchema.safeParse` accepts it; cURL 8.7.1 against a loopback listener (`--connect-to`) sent `Host: evil.example`.
- The SSRF half (the gate and `--resolve` pin judged on the WHATWG host) predates this branch; the host-list half is new in PR-1. The plan names this differential (G-5, M-4) only for redirect `Location` values in PR-3.
- Reviewer: security-sentinel. Severity P1 (confidence high).

## Proposed Solutions

### Option 1: Parse once, hand cURL the parsed `href` (recommended)
**Approach:** In `executeCurlRequest`, `const parsed = new URL(params.url)`; refuse non-empty `username`/`password` or a raw `\`; run the host list, SSRF gate and pin on `parsed`; pass `parsed.href` to `buildCurlArgs`. This is plan task 10's `UrlValidationResult.href` (G-5) pulled forward to hop 1.
**Pros:** closes host-list and SSRF bypass together; PR-3 inherits it. **Cons:** changes the URL string cURL receives (normalisation). **Effort:** s. **Risk:** low.

### Option 2: Branded `ValidatedUrl` type into `buildCurlArgs`
**Approach:** Option 1 plus `buildCurlArgs` accepts only a type the gate constructs, so a raw string cannot reach argv.
**Pros:** unforgettable at the layer. **Cons:** wider signature change. **Effort:** s–m.

### Option 3: Refuse `\` and userinfo only
**Pros:** smallest. **Cons:** a deny-list of differential shapes; misses the next one.

## Recommended Action

(Pending the operator's call.)

## Acceptance Criteria

- [ ] `http://allowed.test\\@evil.test/` with `allowedHosts: ["allowed.test"]` is refused, or cURL's argv carries `new URL(raw).href` whose host is `allowed.test`.
- [ ] Reverse order (`evil.test\\@allowed.test`) pinned by a test.
- [ ] Every hop-1 argv URL equals the validator's parsed `href` (test at `executeCurlRequest`).
- [ ] Teeth: reverting to raw `params.url` fails a test.

## Work Log

### 2026-10-27 - Filed by /sixees-workflow:review (5.2.0 PR-1)
**By:** Claude Code
**Actions:** Surface-2 review of `feat/host-policy-foundations` (23d9f4e..HEAD). Class verified and sweep re-run by the orchestrator.
**Learnings:** see Findings.
