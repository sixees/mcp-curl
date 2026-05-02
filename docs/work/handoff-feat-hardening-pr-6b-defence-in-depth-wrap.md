# Work Handoff: PR-6b — defence-in-depth wrap on YAML/custom-tool output (B3)

**Date:** 2026-05-02
**Branch:** `feat/hardening-pr-6b-defence-in-depth-wrap`
**Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B3 / PR-6b section, lines 638–835)
**Status:** complete

## Summary

Closes the **fourth trust-boundary asymmetry** (custom-tool / YAML-tool / hook short-circuit responses bypassed sanitise+detect+spotlight) by introducing a single defence-in-depth wrap and wiring it into every handler-registration adapter in the codebase. The wrap lives in a new module `src/lib/response/post-processor.ts` and exposes a factory `createWrapper(config) → (result, hostname) => CallToolResult`. Server-scope config (the `enableSpotlighting` flag) is bound once at server creation; request-scope hostname is passed per call so the existing per-host `[injection-defense]` throttle keys correctly.

Companion changes: `sanitizeAndDetect()` now detects on the **original** text *before* sanitising (S4 — preparing for B7/B8 stripping passes that would otherwise erase the malicious phrase before detection sees it), a new throttled `[wrap-error]` logger handles the "wrap itself throws" failure mode (the blind-spot the technical-review pass surfaced), and the `enableSpotlighting` doc comment in `types/public.ts` was rewritten to describe the four-call-site wrap pipeline rather than apologising for partial coverage.

The wrap is **idempotent** via a **module-private** `Symbol("mcp-curl.wrapped")` non-enumerable tag (deliberately not `Symbol.for(...)` — see review-round-1 below), checked via `Object.hasOwn` so an inherited tag from a wrapped prototype cannot bypass the wrap on its own un-processed content (round-2 hardening). The YAML path wraps inside `createToolHandler` (with the real request hostname) AND again at `registerToolsOnServer` (with the `"custom"` label) without double-processing. The wrap is also **fail-open**: any internal exception (including a frozen `tag()` target) returns the original `result` unchanged and emits one throttled `[wrap-error] [hostname] ErrorClassName` line via the new `wrap-error-logger.ts`, whose cleanup interval is wired into `McpCurlServer.start()` / `shutdown()`. Defence-in-depth must never break the handler boundary.

## What was implemented

### New module — `src/lib/response/post-processor.ts`

- **Factory + closure shape (A4):** `createWrapper({ enableSpotlighting })` returns a closure typed `<T extends WrappableResult>(result: T, hostname: string) => T`. The same closure is invoked from every call site — there is no separate `wrapHookResult` variant; the unified signature was simpler and keeps the test surface small.
- **Pipeline per text content part:** `sanitizeAndDetect(part.text, hostname)` (which now detects on original first, then sanitises) → optional `applySpotlighting(sanitised, requestId)` where `requestId = randomUUID()` is generated **once per `wrap()` call** and shared by every text part of the result (per-message scope, A11).
- **Multi-part-aware:** the wrap iterates `result.content` and processes only `type === "text"` parts. Non-text parts (image / audio / resource) pass through unchanged. This is a **deliberate behaviour change** from `maybeApplySpotlighting`, which fail-closed-replaced the entire result with an error when spotlighting was on and `content[0]` was non-text — a posture that broke any custom tool returning a screenshot. The `tool-wrapper.test.ts` test that previously asserted that fail-closed behaviour was rewritten to assert pass-through.
- **Idempotence (A1):** `tag(result)` adds a non-enumerable property keyed on a **module-private** `Symbol("mcp-curl.wrapped")` (the tag is unforgeable from outside this module). `wrap()` short-circuits if the tag is set, using `Object.hasOwn` so an inherited tag from a wrapped prototype cannot bypass the wrap on its own un-processed content. This lets the YAML path double-wrap (inside `createToolHandler` *and* at `registerToolsOnServer`) without re-processing. Tested via direct `vi.spyOn(detectionLogger, "sanitizeAndDetect")` call-count assertions plus a prototype-chain regression test.
- **Try/catch safety net (blind-spot from technical review):** every internal failure (sanitiser pathological-backtracking abort, `Object.defineProperty` on a frozen result, malformed sanitiser output) is contained — the wrap body's outer try/catch and `tag()`'s inner try/catch BOTH return the original `result` unchanged and emit a throttled `[wrap-error] [hostname] ErrorClassName` line. Three regression tests in `post-processor.test.ts` cover frozen `isError`, frozen non-array-content, and sanitiser-throws-on-frozen scenarios.
- **`isWrappedResult(result)`** is exported for tests and inspection. Production callers should rely on the wrap's own short-circuit.

### Detection-logger ordering change — `src/lib/security/detection-logger.ts`

`sanitizeAndDetect()` now does `if (detectInjectionPattern(text)) log(...); return sanitizeResponse(text)` — detection runs against the **original** text. The motivation is forward-readiness for PR-7 (B8 HTML script-strip / markdown-beacon strip): if those passes erase a malicious phrase before detection sees it, the per-host log signal is silenced. Detecting on the original keeps the signal alive.

**Trade-off accepted:** invisible-char-split phrases like `Ig​nore previous instructions` (U+200B between `Ig` and `nore`) no longer fire the per-host log against the original text — the regex doesn't match because the zero-width is not whitespace, so `ignore` becomes `ig​nore`. The returned text is **still sanitised** (the LLM never sees the zero-width), so nothing leaks; the lost signal is observability only. Two existing tests in `processor.test.ts` were rewritten to assert the new contract and document the trade-off explicitly. The trade-off is also documented in `src/lib.ts §7` so future contributors don't accidentally revert.

### New throttled wrap-error logger — `src/lib/security/wrap-error-logger.ts`

Mirrors the shape and ergonomics of `detection-logger.ts`: per-label throttle (60s window), label normalisation strips C0/C1 controls and caps to 128 chars, log line is `[wrap-error] [hostname] ErrorClassName`, never echoes the message (which could itself carry attacker content). The `error.constructor.name` falls back to `"UnknownError"` if a non-`Error` is thrown or the name is empty. The cleanup interval (`startWrapErrorCleanup` / `stopWrapErrorCleanup`) is wired into `McpCurlServer.start()`, the start-failure rollback path, and `shutdown()` — mirroring the existing rate-limit and injection-detection cleanup pairs.

### Wire-up — four call sites

- **`src/lib/extensible/tool-wrapper.ts`** — `maybeApplySpotlighting()` deleted (and its `isSpotlightEnvelope` import). Both `registerCurlToolWithHooks` and `registerJqToolWithHooks` build a `wrap = createWrapper(config)` once and pass `wrap` plus a `hostnameOf: (params) => string` extractor into `executeWithHooks`. The wrap fires inside `executeWithHooks` at the pipeline exit using the **post-hook** params, so a `beforeRequest` hook that rewrites `params.url` (e.g. proxy routing) is correctly attributed in the per-host throttle. Curl uses `(p) => safeHostname(p.url)`; jq uses `() => JQ_QUERY_HOSTNAME_LABEL`. There is no separate outer wrap at the call site — the wrap fires exactly once per tool invocation.
- **`src/lib/extensible/hook-executor.ts`** — `executeWithHooks` signature gains a `wrap: WrapFn` parameter and a `hostnameOf: (params) => string` extractor. The `beforeRequest` shortCircuit branch wraps the synthesised `CallToolResult` with `wrap(shortCircuitResult, hostnameOf(ctx.params))` (S2 closure). The post-execution path wraps with `wrap(response, hostnameOf(ctx.params))`. Both call sites compute hostname from the **final** `ctx.params` after every `beforeRequest` hook has had its turn, closing the round-1 hostname-mis-attribution finding.
- **`src/lib/schema/generator.ts`** — `GeneratorConfig` gains `enableSpotlighting?: boolean`. `createToolHandler` builds `wrap` once at handler construction and calls `wrap(result, safeHostname(url))` after `executeCurlRequest`. `src/lib/api-server.ts` propagates `mergedConfig.enableSpotlighting` into `generatorConfig` **after** the `...options.generatorConfig` spread so the server-level invariant cannot be overridden by callers (round-1 hardening — closes the YAML-vs-built-in asymmetry from re-emerging through a per-call override).
- **`src/lib/extensible/mcp-curl-server.ts`** — `registerToolsOnServer` wraps every entry in `_customTools` via `const wrappedHandler: typeof handler = async (params, extra) => wrap(await handler(params, extra), CUSTOM_TOOL_HOSTNAME_LABEL)` before passing to `server.registerTool`. Typed declaration replaces the round-1 `(...args: unknown[])` cast cascade. Both user-supplied custom tools and YAML-derived custom tools (which flow through `registerCustomTool` via `createApiServer`) are covered. YAML tools are double-wrapped (inner wrap inside `createToolHandler` with the real hostname; outer wrap at registration with `"custom"` label) but the own-property symbol-tag idempotence makes the outer call a no-op. The deliberate redundancy keeps the per-host throttle keyed on the real hostname for YAML tools.

### Tests

- **New: `src/lib/response/post-processor.test.ts`** — 28 cases across nine describe blocks: basic shape, sanitisation/detection, spotlighting (per-message UUID assertions), idempotence (including spread-loses-tag regression guard and a `vi.spyOn` call-count assertion that the second wrap call doesn't re-run `sanitizeAndDetect`), error handling (try/catch + wrap-error log assertion), frozen-input fail-open (3 cases — round-1), own-property tag check (2 cases — round-2 prototype-chain bypass closure), null/undefined content items (2 cases — round-2 resilience), and content-shape edge cases (multi-part, non-string text, non-array content).
- **New: `src/lib/security/wrap-error-logger.test.ts`** — 11 cases covering log format, message non-leakage, throttle, hostname normalisation, fallback to `UnknownError`, and cleanup eviction.
- **Extended: `src/lib/security/detection-logger.test.ts`** — new describe block `sanitizeAndDetect — detect-on-original ordering (PR-6b / S4)` with 4 cases (sanitise-output assertion, detection on clean text, S4-equivalent assertion, no-log-on-benign-text).
- **Extended: `src/lib/extensible/tool-wrapper.test.ts`** — replaced the old fail-closed test with a multi-part pass-through test, plus four new PR-6b cases covering the 4th asymmetry, injection-detection logging keyed on the request hostname, the WRAPPED idempotence tag, and the S2 hook-short-circuit closure regression.
- **Extended: `src/lib/extensible/mcp-curl-server.test.ts`** — new `PR-6b custom-tool wrap (registerToolsOnServer)` describe block. To exercise the wrap (which only fires after `start()`), the test stubs `createServer` from `server-factory.ts` with a fake `McpServer` whose `registerTool` captures the wrapped handler, then invokes it directly. Five cases: 4th asymmetry sanitisation, injection-detection keyed on `"custom"` label, spotlighting wrap, **forged-`Symbol.for(...)` security closure** (round-1: a forged tag from outside the module is ignored), error pass-through.
- **Extended: `src/lib/schema/schema.test.ts`** — new `PR-6b wrap on YAML-tool output` describe block, 5 cases covering sanitisation, spotlighting on/off, hostname-keyed log, and error pass-through.
- **Updated: `src/lib/response/processor.test.ts`** — two tests rewritten to assert the new detect-on-original contract and document the trade-off.

## Key decisions

| Decision | Reasoning | Alternatives considered |
|----------|-----------|------------------------|
| Single closure `(result, hostname) => result` (not separate `wrapHookResult`) | The hostname-per-call factory shape (A4) already covers the hook-short-circuit case — the only difference is *when* the closure is called, not what it does. A second exported entry point would have duplicated the body. | Second `wrapHookResult` entry point as the plan suggested as an option. |
| Wrap at BOTH `createToolHandler` and `registerToolsOnServer` for YAML tools | The inner wrap has the real request hostname; the outer wrap uses `"custom"`. The outer wrap is a no-op (Symbol-tag), but it's the only chokepoint that catches user-defined custom tools that don't go through `createToolHandler`. Putting the wrap only at `registerToolsOnServer` would have lost hostname fidelity for YAML tools. Putting it only at `createToolHandler` would have skipped user custom tools entirely. | Wrap only at one site; route everything through that site. The YAML hostname loss was the deciding factor. |
| `safeHostname()` reused; no new URL parser | The plan called for `safeHostname` re-export from `lib.ts` (already done in PR-1). The wrap should use the same fallback rules as the rest of the codebase so `[injection-defense]` and `[wrap-error]` keys agree on hostname for the same request. | Roll a parser inside post-processor.ts. |
| Multi-part wrap iterates content; non-text parts pass through | The plan's diff sketch explicitly says "Multi-part content array (mix of `text` and non-`text`) → only text parts are processed." The old `maybeApplySpotlighting` fail-closed behaviour broke any custom tool returning images. The new pass-through is more correct and more permissive. | Preserve the strict fail-closed for `content[0]` non-text + spotlighting on (the existing test). Updated the test instead. |
| `sanitizeAndDetect` detect-on-original despite known regression for invisible-char-split phrases | The plan's S4 explicitly chose detect-on-original for B7/B8 forward-readiness. The trade-off is documented and observability-only — the LLM still sees sanitised text. | Detect on BOTH original AND sanitised (catches both classes; doubles regex cost). Rejected as scope creep beyond the plan. |
| `wrap-error-logger.ts` mirrors `detection-logger.ts` rather than sharing code | The two loggers have identical shape but different log prefixes and different throttle maps. Sharing would require a generic `createThrottledLabelLogger(prefix)` factory, which is more code than two near-identical files. The pattern is small enough that duplication is honest. | Extract a `createThrottledLabelLogger` factory. Deferred. |
| Symbol tag is non-enumerable (and therefore lost across `JSON.stringify` / spread) | This is the standard idempotence-tag pattern. A regression test in `post-processor.test.ts` ("spread copy of a wrapped result is no longer tagged") documents the property explicitly so a future contributor doesn't expect spread to preserve it. The wrap itself uses `tag({ ...result, content: newContent })` and re-tags after the spread. | Use a `WeakSet<Result>` registry. Rejected: extra module state, GC concerns, doesn't survive serialisation either, more allocation. |
| Wrap built once per registration, not per call | Tiny perf win and matches the factory pattern already used by `registerCustomTool` etc. | Build per call. |

## What to pay attention to during review

- **Detect-on-original is a real regression for invisible-char-split phrases.** Two `processor.test.ts` cases were rewritten from "detection fires on sanitised text" to "detection does NOT fire; sanitised text still emerges clean." The trade-off is intentional per the plan's S4, but reviewers should confirm they're comfortable with the lost signal. PR-7/PR-8 will close additional cases (HTML script-strip, NFKC normalisation in detection) but neither closes this specific regression — UTS #39 skeleton folding (mentioned in the plan as a future iteration) would.
- **YAML tools are wrapped twice.** Look at `createToolHandler` (wraps with real hostname) and `registerToolsOnServer` (wraps with `"custom"`). The outer wrap is a no-op via the own-property symbol-tag check. If a future refactor moves the inner wrap somewhere else or removes the tag short-circuit, the outer wrap would either double-process or silently switch to using `"custom"` as the per-host log label. The `vi.spyOn(sanitizeAndDetect)` call-count test in `post-processor.test.ts` is the regression guard.
- **The `executeWithHooks` signature change is a breaking change for any internal caller.** Currently only `tool-wrapper.ts` calls it (verified via grep). If anyone else starts calling it, they need to pass `wrap: WrapFn` and `hostnameOf: (params) => string`. The signature change and the rationale (hostname must reflect post-hook params) are documented in the file's JSDoc.
- **Mock setup in `mcp-curl-server.test.ts`'s new PR-6b describe block.** It stubs `createServer` from `server-factory.ts` to inject a fake `McpServer`. If any future refactor changes how the server is constructed (e.g. moves construction inline, adds intermediate wrappers), the stub needs updating. Reviewer should confirm the stub captures the right registration shape.
- **`Symbol.for("mcp-curl.wrapped")` from outside the module is intentionally ignored.** A custom-tool author who tries to pre-tag a result with the global-registry symbol will find their tag has no effect — the wrap's WRAPPED constant is a module-private `Symbol(...)` that no external caller can synthesise. Verified by the `forged_tag` security-closure test in `mcp-curl-server.test.ts`. If a future refactor switches back to `Symbol.for(...)` it reopens the bypass; the rationale lives in the doc comment above the constant declaration.
- **Pattern deviation: detect-on-original is documented in only two places.** `src/lib.ts §7` (consumer-facing) and `src/lib/security/detection-logger.ts` JSDoc (implementation-facing). If a third caller is added, the trade-off should be documented at the caller's site too.

## Known issues and limitations

- **`isSpotlightEnvelope` is now only used internally by `applySpotlighting` and by the `sanitize.test.ts` test suite.** It's still exported from `src/lib.ts` (PR-1 added it). Keeping the export is the conservative choice — it's a public API with documented semantics, removing it would be a minor-version break — but a reviewer might want to check whether any consumer depends on it. None in this codebase.
- **The `WRAPPED` symbol is silently lost under `JSON.stringify`/spread.** Documented in a regression test. If a hook ever does `JSON.parse(JSON.stringify(result))` between the wrap and return-to-LLM, the result would be re-wrappable. No current code path does this.
- **Custom-tool hostname is always `"custom"`.** A future API could let callers supply their own label (e.g. when a custom tool wraps a single upstream), but this is YAGNI today — the `[injection-defense] [custom]` channel is already useful as "any custom tool fired".
- **Hook-executor signature change is not isolated behind a feature flag.** Anyone forking this code and patching `hook-executor.ts` independently will hit a merge conflict. The signature change is small (two added params) but it IS a change.
- **The wrap doesn't sanitise non-text content parts.** An image part with embedded EXIF text, or a resource part with malicious URI, would pass through unchanged. The plan's scope was text-content sanitisation; defending other content types is out of scope.
- **`createWrapper` itself is not exported from `src/lib.ts`.** Library consumers can't build their own wrappers. The wrap is applied automatically to every registered tool; consumers only interact with it via `enableSpotlighting`. If a consumer needs to wrap text on their own (outside the MCP tool path), they should compose `sanitizeAndDetect` + `applySpotlighting` directly using the existing public exports. This was a deliberate scope choice — exporting `createWrapper` would multiply our public-API surface for a use case that doesn't exist yet.
- **No benchmark coverage.** The wrap adds: one symbol read on every call; for non-error / array-content cases, one `.map()` over content + per-text-part `sanitizeAndDetect` (which the curl path was already doing in `processor.ts`) + optional `applySpotlighting`. Net addition for curl_execute is one extra `sanitizeAndDetect` call (the inner `processor.ts` call already ran, so the second pass against already-sanitised text is essentially zero-cost — Unicode-attack-range matches against clean text return immediately). Net addition for jq_query: same. Net addition for custom tools: one full pass (which is the whole point — they had no defence before). The plan's perf-budget framework lands in PR-9.

## Testing summary

- **Test files added:** 2 (`post-processor.test.ts` 28 cases, `wrap-error-logger.test.ts` 11 cases).
- **Test files updated:** 5 (`detection-logger.test.ts` +4, `tool-wrapper.test.ts` rewrote 1, added 4; `mcp-curl-server.test.ts` +5; `schema.test.ts` +5; `processor.test.ts` rewrote 2).
- **Total tests now:** 742 passing, 7 skipped (was 685 / 7 after PR-6a → +57 net across the original commit, round-1 review fixes, and round-2 review fixes).
- **Build:** `npm run build` clean, no TypeScript errors or warnings. All `as ToolResult` casts in `hook-executor.ts` were removed during round-1 thanks to the tightened `WrappableResult` typing.
- **Lint:** the codebase doesn't have an ESLint script in `package.json`; no separate lint pass.
- **Manual testing:** none required — every behavioural change is covered by a regression test.
- **Test gaps:**
  - No end-to-end test that fires a real MCP `tools/call` request through `start("stdio")`. The mocked-McpServer pattern in `mcp-curl-server.test.ts` is one level shallower. An e2e test would need an in-memory transport pair from the MCP SDK; the existing test files don't have that infrastructure and it's a separate undertaking.
  - No load-test of the wrap throttle (`logWrapError` cleanup interval). The throttle is bounded by hostname cardinality; load testing would be useful when wired into the server lifecycle.
  - No regression test for the case "wrap throws inside `applySpotlighting` because the UUID validator rejects" — `randomUUID()` always passes the validator, so the only way to hit it is via direct API misuse. Not realistic in the wrap call path.

## Commit history

Will appear after commit; planned single commit:

```
feat(response): defence-in-depth wrap on YAML/custom-tool/hook output (PR-6b / B3)
```

## Review context

- **Suggested review order:**
  1. `src/lib/response/post-processor.ts` — the load-bearing module. Read its top-of-file doc block first; it documents the design decisions inline.
  2. `src/lib/security/detection-logger.ts` — the S4 reordering. Three lines of code change but a real behavioural shift; trade-off documented in the JSDoc.
  3. `src/lib/security/wrap-error-logger.ts` — the blind-spot closure. Mirrors `detection-logger.ts` shape.
  4. `src/lib/extensible/tool-wrapper.ts` + `src/lib/extensible/hook-executor.ts` — the curl/jq + hook wire-up. The `executeWithHooks` signature change matters.
  5. `src/lib/schema/generator.ts` + `src/lib/api-server.ts` — the YAML wire-up. `enableSpotlighting` flows through `GeneratorConfig`.
  6. `src/lib/extensible/mcp-curl-server.ts` — the registration adapter. The double-wrap-but-idempotent design.
  7. `src/lib/types/public.ts` + `src/lib.ts` — public-facing doc updates only.
  8. Test files — regression coverage and the test-side mocking strategy for `registerToolsOnServer`.

- **Plan section:** lines 638–835 of `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md`. The 12-item acceptance criteria block (lines 815–828) is now fully ticked.

- **Dependency on other work:** PR-6a (B9 sanitise-at-validate) is merged on `main` and is the immediate predecessor in the recommended landing order. PR-7 (response-side sanitisation expansion — HTML script-strip, markdown beacons, sanitisation gaps) is the natural next-up; it's the PR whose stripping passes the S4 reordering was made for.

- **Cross-references in plan:** S2 (hook short-circuit), S4 (detection ordering), A1 (idempotence symbol), A4 (factory shape), A11 (per-message UUID), and the unsigned-by-any-reviewer "blind-spot" (try/catch safety net) all converged into this PR. Each is referenced inline at its implementation site.

## Follow-up work

- [ ] Wire `startWrapErrorCleanup` into `McpCurlServer.start()` and `stopWrapErrorCleanup` into `shutdown()`, mirroring the `startInjectionCleanup` / `stopInjectionCleanup` pair. **Why deferred:** PR-6b was scoped to the wrap module + wire-up; lifecycle wiring touches `McpCurlServer.start()` / `shutdown()` and would expand the file-set.
- [ ] PR-7 (B7 sub-1-3 + B8) — response-side sanitisation expansion. Owns the HTML script-strip, markdown beacon strip, ReDoS-hardened patterns, and the additional Unicode invisibles (Sneaky Bits VS Supplement, Braille blank, Arabic letter mark). The S4 reordering in this PR is forward-readiness for that work.
- [ ] PR-8 (B7 sub-4-5) — detection-pattern expansion (NFKC normalisation, widened bounded wildcards, synonym variants). Lands after PR-7 (shared `sanitize.ts`).
- [ ] Final cleanup commit (WBS item 15) — delete `docs/todos/` directory (already empty) once all 8 PRs have shipped. `docs/upstream-contributions.md` is already gone.
- [ ] Consider whether to export `createWrapper` from `src/lib.ts` if a real consumer use case appears. Today it's internal-only.

### Outstanding Todos
<!-- Todos created this session that still need work — see docs/todos/ for full content -->
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none_ | — | — | — |

### Resolved Todos
<!-- Recorded before deletion. File no longer exists in docs/todos/. -->
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — input was a plan section, not a `docs/todos/` file_ | — | — | — | — |

---

## Review Comments Addressed — 2026-05-02 (PR #29 round 1)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `Symbol.for("mcp-curl.wrapped")` is publicly forgeable — any custom-tool author can pre-tag a result and bypass the wrap | self-review (security-sentinel) | **P1 — Fix needed** | Switched to module-private `Symbol("mcp-curl.wrapped")`. Test in `mcp-curl-server.test.ts` rewritten as a positive security closure: a forged `Symbol.for(...)` tag is now ignored and the wrap fires normally. |
| Catch-path `tag(result)` can re-throw on frozen results, breaking fail-open | @chatgpt-codex-connector + @coderabbitai (duplicate) | **P1 — Fix needed** | Moved the try/catch *into* `tag()` itself so every call site is safe. Added 3 regression tests in `post-processor.test.ts` covering frozen `isError`, frozen non-array-content, and sanitiser-throws-on-frozen scenarios. |
| `enableSpotlighting` set before `...options.generatorConfig` spread — caller can override server invariant | @coderabbitai | **P2 — Fix needed** | Moved `enableSpotlighting` AFTER the spread in `api-server.ts`; now server-level is authoritative. |
| `(...args: unknown[]) => ... as typeof handler` cast cascade in `registerToolsOnServer` | @gemini-code-assist | **P2 — Fix needed** | Replaced with `const wrappedHandler: typeof handler = async (params, extra) => {...}`. Removed unused `WrappableResult` import. |
| Hostname computed before `executeWithHooks` — `beforeRequest` hooks rewriting `params.url` were ignored | @chatgpt-codex-connector | **P2 — Fix needed** | Refactored `executeWithHooks` to take a `hostnameOf: (params) => string` extractor and call wrap at the pipeline exit using `hostnameOf(ctx.params)`. The wrap now sees the post-hook URL for both the short-circuit and the post-execution paths. Removed redundant outer wrap call from `tool-wrapper.ts` (wrap now fires once inside `executeWithHooks`). |
| `startWrapErrorCleanup` exported but not wired into `McpCurlServer` lifecycle | @coderabbitai | **P2 — Fix needed** | Added `_wrapErrorCleanupInterval` field, started in `start()`, stopped in both the rollback path and `shutdown()`. Mirrors the existing `injectionCleanupInterval` pattern. Removes the known-issue from the original handoff. |
| Suggestion to `Object.freeze(tag({...}))` for Readonly contract | @gemini-code-assist | **False positive (partial)** | The literal suggestion would break the wrap (`tag()` uses `Object.defineProperty`, which throws on frozen targets). Underlying concern (cast cascade) addressed by tightening `WrappableResult` instead: `text?: string` (was `unknown`), `content?: WrappableContentPart[]` (was `\| unknown`), and explicit `_meta` / `structuredContent` fields to lock the SDK 1.x preservation contract. With these tighter types the `as ToolResult` casts in `hook-executor.ts` are gone (verified by build). |
| JSDoc example `Ig​nore previous instructions` is misleading — that case is no longer detected | @coderabbitai | **P3 — Fix needed** | Rewrote the `sanitizeAndDetect` JSDoc: removed the misleading example, added explicit acknowledgement of the lost-signal class, and pointed to UTS #39 skeleton folding as the deferred future work that closes it. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| `Symbol.for("mcp-curl.wrapped")` — global registry for cross-realm idempotence | Module-private `Symbol("mcp-curl.wrapped")` | The cross-realm property was a security liability, not a feature: any code in this realm could synthesise the same key and bypass the wrap. Module-private symbol means `tag()` is the only way the WRAPPED bit is ever set. The trade-off (no idempotence across module duplication) is acceptable because the wrap is semantically idempotent on already-sanitised text — a re-run is one extra O(n) pass at worst, never a correctness issue. | self-review (security-sentinel) |
| Catch-path emits `logWrapError` then calls `tag(result)` directly | `tag()` itself swallows `Object.defineProperty` failures internally | A single guard inside `tag()` covers every call site (success path, isError pass-through, non-array-content pass-through, catch path) without per-site try/catch noise. | @chatgpt-codex-connector + @coderabbitai |
| `executeWithHooks` takes a static `hostname: string` | `executeWithHooks` takes a `hostnameOf: (params) => string` extractor and computes hostname at the wrap boundary using `ctx.params` | Hostname must reflect the **final** params after `beforeRequest` hooks have had their turn — a hook that rewrites `params.url` (proxy routing, retry-with-backoff to a different host) was previously misattributed. The extractor pattern centralises hostname logic in the executor and lets each tool define its own (`safeHostname(p.url)` for curl_execute, constant for jq_query). | @chatgpt-codex-connector |
| `WrappableResult.content?: WrappableContentPart[] \| unknown`; `text?: unknown` | `content?: WrappableContentPart[]`; `text?: string`; explicit `_meta?` / `structuredContent?` | The `\| unknown` and `unknown` text were over-defensive — the runtime guards already enforced the narrower shapes. Tightening removes the `as ToolResult` casts entirely (verified by build) and locks the SDK 1.x `_meta`/`structuredContent` preservation in the type system. | @gemini-code-assist (partial) + self-review (typescript-reviewer) |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — review feedback was inline PR threads, not `docs/todos/` files_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — all 8 PR threads addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/response/post-processor.ts` (Symbol private, tag try/catch internal, WrappableResult tightened)
- `src/lib/response/post-processor.test.ts` (+3 frozen-input fail-open regression tests; total 24)
- `src/lib/security/detection-logger.ts` (JSDoc rewrite)
- `src/lib/extensible/hook-executor.ts` (HostnameExtractor signature; wrap at pipeline exit; cast removal)
- `src/lib/extensible/tool-wrapper.ts` (drops outer wrap; uses hostnameOf extractor)
- `src/lib/extensible/mcp-curl-server.ts` (typed wrappedHandler; wrap-error cleanup lifecycle wiring)
- `src/lib/extensible/mcp-curl-server.test.ts` (security-closure rewrite of forged-tag test)
- `src/lib/api-server.ts` (`enableSpotlighting` after generatorConfig spread)

### Tests / build
- `npm test`: 738/738 passing (7 skipped) — was 735 pre-fix, +3 frozen-result fail-open regression tests
- `npm run build`: clean — three `as ToolResult` casts in `hook-executor.ts` removed without TypeScript errors

---

## Review Comments Addressed — 2026-05-02 (PR #29 round 2)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `result[WRAPPED]` reads inherited symbol-keyed properties via prototype chain — an object whose prototype was wrapped earlier inherits the tag and bypasses the wrap on its own un-processed content | @coderabbitai | **P2 — Fix needed** | Switched both `isWrappedResult()` and `tag()`'s fast-path to `Object.hasOwn(result, WRAPPED)` so only own-property tags short-circuit. Added 2 prototype-chain regression tests. |
| `processTextPart()` assumes every `content` entry is a non-null object — a single `null`/`undefined` element throws, hits the outer catch, and the wrap returns the original result with NO sanitisation on any text part | @coderabbitai | **P2 — Fix needed** | Widened `processTextPart` to accept `unknown` and added a `part === null \|\| typeof part !== "object"` guard at the top so malformed entries pass through unchanged while valid text parts still get sanitise + detect + spotlight. Added 2 null/undefined-content-item regression tests. |
| Design note 3 in `post-processor.ts:27-33` still says `Symbol.for("mcp-curl.wrapped")` — stale after the round-1 hardening | @coderabbitai | **P3 — Fix needed (docs)** | Rewrote the design note: now describes the module-private `Symbol(...)` choice, the `Object.hasOwn` own-property check, and the rationale (forgery prevention). |
| Handoff document Summary / What was implemented / Known issues / What to pay attention to / Testing summary sections still describe pre-round-1 behaviour | @coderabbitai | **P3 — Fix needed (docs)** | Refreshed every section to match the post-round-1 + post-round-2 shipped code: module-private symbol with `Object.hasOwn` check, wrap-error lifecycle now wired, wrap fires inside `executeWithHooks` not at the outer call site, hostnameOf extractor pattern, typed `wrappedHandler`, removed obsolete "Pre-tagged-result test" caveat (replaced with the security-closure note). Test totals updated 735→745. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| `result[WRAPPED] === true` direct property access | `Object.hasOwn(result, WRAPPED) && result[WRAPPED] === true` | Symbol-keyed access traverses the prototype chain. An object whose prototype was wrapped earlier inherits the tag — the symbol's module-privacy prevents *external* forgery, but does not prevent inheritance from a previously-wrapped prototype within the same module. Restricting to own properties closes that gap. | @coderabbitai |
| `processTextPart(part: WrappableContentPart)` — typed `part` (assumed non-null object) | `processTextPart(part: unknown)` with a `part === null \|\| typeof part !== "object"` guard returning `part` unchanged | A single null/undefined entry in `content[]` would throw out of `.map()`, trigger the outer catch, and abort the whole wrap — every other text part in the array silently skips sanitise/detect. The widened input + early guard preserves processing for valid entries. | @coderabbitai |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — review feedback was inline PR threads, not `docs/todos/` files_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — all 4 round-2 PR threads addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/response/post-processor.ts` (Object.hasOwn in `isWrappedResult` + `tag`; `processTextPart` accepts `unknown` with null guard; design-note 3 rewritten)
- `src/lib/response/post-processor.test.ts` (+4 regression tests: 2 prototype-chain + 2 null-content-item)
- `docs/work/handoff-feat-hardening-pr-6b-defence-in-depth-wrap.md` (Summary / What was implemented / Wire-up / Tests / What to pay attention to / Known issues / Testing summary all refreshed)

### Tests / build
- `npm test`: 742/742 passing (7 skipped) — was 738 after round-1, +4 net (2 prototype-chain regression + 2 null-content-item regression)
- `npm run build`: clean

---

## Review Comments Addressed — 2026-05-02 (PR #29 round 3)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `result.isError` short-circuit bypassed sanitise/detect entirely — a buggy or hostile custom tool / YAML handler / hook short-circuit could emit `{isError:true, content:[{text: <attacker bytes>}]}` and skip the defence-in-depth pass | @coderabbitai | **P2 — Fix needed** | Removed the `isError` early-return. Sanitise + detect now always run on every text part regardless of `isError`. The spotlighting step is the only thing gated off for errors (no UUID, no sentinels — error text is a status message about the call, not external content the LLM should treat as untrusted with sentinel boundaries). Added a regression test that asserts injection-detection logs fire on error text containing a malicious phrase, and rewrote the existing isError test to assert sanitise still runs (bidi/zero-width chars stripped from error text). |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| `if (result.isError) return tag(result)` — error results pass through with no sanitise / no detect / no spotlight, on the assumption that error text is internally generated | Drop the isError short-circuit; always run sanitise + detect; gate ONLY the spotlighting UUID on `!result.isError`. Errors are sanitised + detected like any other content, but do NOT receive sentinel boundaries (error text is a status message, not external content). | The original assumption ("error text is internally generated") only holds for built-in tools. Custom tool handlers, YAML handlers calling external APIs, and hook short-circuits can all emit error content that mirrors or includes attacker-controlled bytes. The regression closes the bypass without losing the "no sentinels on errors" semantic. | @coderabbitai |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — review feedback was an inline PR thread, not a `docs/todos/` file_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — round-3 thread addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/response/post-processor.ts` (drop `isError` short-circuit; gate `requestId` generation on `enableSpotlighting && !result.isError`)
- `src/lib/response/post-processor.test.ts` (rewrote `isError results pass through unchanged but are tagged` to assert sanitise still runs; added `logs an injection-detection event on error text containing a malicious phrase` regression test; updated frozen-isError test to assert sanitised content rather than reference equality)
- `docs/work/handoff-feat-hardening-pr-6b-defence-in-depth-wrap.md` (this section)

### Tests / build
- `npm test`: 743/743 passing (7 skipped) — was 742 after round-2, +1 net regression test (the rewritten isError test still counts as one; the new injection-detection-on-error test is the +1)
- `npm run build`: clean

---

## Review Comments Addressed — 2026-05-02 (PR #29 round 4)

### Changes Made
| Comment | Reviewer | Category | Action Taken |
|---------|----------|----------|--------------|
| `Object.hasOwn(result, WRAPPED)` in `isWrappedResult` and `tag` is not wrapped in try/catch — a Proxy whose `getOwnPropertyDescriptor` (or `get`) trap throws breaks fail-open at line 209 (`isWrappedResult` call sits BEFORE the wrap's outer try/catch) and again at line 245 (catch fallback's `tag(result)` call) | @coderabbitai | **P2 — Fix needed** | Extracted a private `hasOwnWrappedTag(result)` helper that wraps both the `Object.hasOwn` probe AND the symbol-keyed value read in try/catch, returning `false` on error. Both `isWrappedResult` and `tag()`'s fast-path now route through the helper, so a hostile Proxy cannot break the documented fail-open contract. Added 4 regression tests in `post-processor.test.ts`: `isWrappedResult` returns `false` on a throwing-trap Proxy; the wrap entry-path probe doesn't throw; the catch fallback's `tag()` call doesn't throw on a throwing-trap Proxy (forced via sanitiser-fails mock); the `get`-trap-on-symbol case (descriptor reports tag exists, but reading the value throws) is also contained. |

### Decisions Revised
| Original Decision | New Approach | Reason | Reviewer |
|-------------------|--------------|--------|----------|
| `Object.hasOwn(result, WRAPPED)` called bare in `isWrappedResult` and `tag()` | Routed through `hasOwnWrappedTag()`, a private helper that try/catches both the descriptor probe and the symbol-keyed value read | A custom-tool author can return a Proxy with arbitrary trap behaviour, including a throwing `getOwnPropertyDescriptor` or `get` trap. The wrap's documented fail-open contract ("Defence-in-depth must never propagate exceptions to the handler boundary") was violated for that input — at the `isWrappedResult(result)` call before the outer try/catch, and again at `tag(result)` inside the catch fallback. The helper is a one-line containment that costs nothing for non-Proxy inputs. | @coderabbitai |

### Resolved Todos
| File (removed) | Title | Summary | Resolved by | Date |
|----------------|-------|---------|-------------|------|
| _none — review feedback was an inline PR thread, not a `docs/todos/` file_ | — | — | — | — |

### Outstanding Todos
| File | Priority | Description | Source |
|------|----------|-------------|--------|
| _none — round-4 thread addressed in this commit_ | — | — | — |

### Files Modified
- `src/lib/response/post-processor.ts` (extract `hasOwnWrappedTag` helper; route `isWrappedResult` and `tag()` fast-path through it; doc-comments updated)
- `src/lib/response/post-processor.test.ts` (+4 hostile-Proxy regression tests in new describe block)
- `docs/work/handoff-feat-hardening-pr-6b-defence-in-depth-wrap.md` (this section)

### Tests / build
- `npm test`: 747/747 passing (7 skipped) — was 743 after round-3, +4 net (Proxy fail-open regression tests)
- `npm run build`: clean
