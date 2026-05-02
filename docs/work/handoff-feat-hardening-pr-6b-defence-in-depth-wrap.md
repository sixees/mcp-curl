# Work Handoff: PR-6b — defence-in-depth wrap on YAML/custom-tool output (B3)

**Date:** 2026-05-02
**Branch:** `feat/hardening-pr-6b-defence-in-depth-wrap`
**Plan:** `docs/plans/2026-04-30-chore-pre-bigwork-hardening-plan.md` (B3 / PR-6b section, lines 638–835)
**Status:** complete

## Summary

Closes the **fourth trust-boundary asymmetry** (custom-tool / YAML-tool / hook short-circuit responses bypassed sanitise+detect+spotlight) by introducing a single defence-in-depth wrap and wiring it into every handler-registration adapter in the codebase. The wrap lives in a new module `src/lib/response/post-processor.ts` and exposes a factory `createWrapper(config) → (result, hostname) => CallToolResult`. Server-scope config (the `enableSpotlighting` flag) is bound once at server creation; request-scope hostname is passed per call so the existing per-host `[injection-defense]` throttle keys correctly.

Companion changes: `sanitizeAndDetect()` now detects on the **original** text *before* sanitising (S4 — preparing for B7/B8 stripping passes that would otherwise erase the malicious phrase before detection sees it), a new throttled `[wrap-error]` logger handles the "wrap itself throws" failure mode (the blind-spot the technical-review pass surfaced), and the `enableSpotlighting` doc comment in `types/public.ts` was rewritten to describe the four-call-site wrap pipeline rather than apologising for partial coverage.

The wrap is **idempotent** via a `Symbol.for("mcp-curl.wrapped")` non-enumerable tag, so the YAML path can wrap inside `createToolHandler` (with the real request hostname) AND again at `registerToolsOnServer` (with the `"custom"` label) without double-processing. The wrap is also **fail-open**: any internal exception returns the original `result` unchanged and emits one throttled `[wrap-error] [hostname] ErrorClassName` line — defence-in-depth must never break the handler boundary.

## What was implemented

### New module — `src/lib/response/post-processor.ts`

- **Factory + closure shape (A4):** `createWrapper({ enableSpotlighting })` returns a closure typed `<T extends WrappableResult>(result: T, hostname: string) => T`. The same closure is invoked from every call site — there is no separate `wrapHookResult` variant; the unified signature was simpler and keeps the test surface small.
- **Pipeline per text content part:** `sanitizeAndDetect(part.text, hostname)` (which now detects on original first, then sanitises) → optional `applySpotlighting(sanitised, requestId)` where `requestId = randomUUID()` is generated **once per `wrap()` call** and shared by every text part of the result (per-message scope, A11).
- **Multi-part-aware:** the wrap iterates `result.content` and processes only `type === "text"` parts. Non-text parts (image / audio / resource) pass through unchanged. This is a **deliberate behaviour change** from `maybeApplySpotlighting`, which fail-closed-replaced the entire result with an error when spotlighting was on and `content[0]` was non-text — a posture that broke any custom tool returning a screenshot. The `tool-wrapper.test.ts` test that previously asserted that fail-closed behaviour was rewritten to assert pass-through.
- **Idempotence (A1):** `tag(result)` adds a non-enumerable `[Symbol.for("mcp-curl.wrapped")]: true` property; `wrap()` short-circuits if the tag is set. This lets the YAML path double-wrap (inside `createToolHandler` *and* at `registerToolsOnServer`) without re-processing. Tested via direct `vi.spyOn(detectionLogger, "sanitizeAndDetect")` call-count assertions.
- **Try/catch safety net (blind-spot from technical review):** the entire wrap body is enclosed; on error, `logWrapError(hostname, err)` is called and the original `result` is returned (still tagged so a downstream wrap doesn't retry). This is the "defence-in-depth must never propagate exceptions to the handler boundary" invariant.
- **`isWrappedResult(result)`** is exported for tests and inspection. Production callers should rely on the wrap's own short-circuit.

### Detection-logger ordering change — `src/lib/security/detection-logger.ts`

`sanitizeAndDetect()` now does `if (detectInjectionPattern(text)) log(...); return sanitizeResponse(text)` — detection runs against the **original** text. The motivation is forward-readiness for PR-7 (B8 HTML script-strip / markdown-beacon strip): if those passes erase a malicious phrase before detection sees it, the per-host log signal is silenced. Detecting on the original keeps the signal alive.

**Trade-off accepted:** invisible-char-split phrases like `Ig​nore previous instructions` (U+200B between `Ig` and `nore`) no longer fire the per-host log against the original text — the regex doesn't match because the zero-width is not whitespace, so `ignore` becomes `ig​nore`. The returned text is **still sanitised** (the LLM never sees the zero-width), so nothing leaks; the lost signal is observability only. Two existing tests in `processor.test.ts` were rewritten to assert the new contract and document the trade-off explicitly. The trade-off is also documented in `src/lib.ts §7` so future contributors don't accidentally revert.

### New throttled wrap-error logger — `src/lib/security/wrap-error-logger.ts`

Mirrors the shape and ergonomics of `detection-logger.ts`: per-label throttle (60s window), label normalisation strips C0/C1 controls and caps to 128 chars, log line is `[wrap-error] [hostname] ErrorClassName`, never echoes the message (which could itself carry attacker content). The `error.constructor.name` falls back to `"UnknownError"` if a non-`Error` is thrown or the name is empty. Re-uses the same throttle interval cadence (`startWrapErrorCleanup` / `stopWrapErrorCleanup`); these are exported for symmetry with the injection cleanup pair but are not yet wired into `McpCurlServer`'s lifecycle — the throttle map is bounded by hostname cardinality and the cleanup interval is a future hardening step (see *Known issues*).

### Wire-up — four call sites

- **`src/lib/extensible/tool-wrapper.ts`** — `maybeApplySpotlighting()` deleted (and its `isSpotlightEnvelope` import). Both `registerCurlToolWithHooks` and `registerJqToolWithHooks` build a `wrap = createWrapper(config)` once and call `wrap(result, hostname)` after `executeWithHooks`. Hostname is `safeHostname(transformedParams.url)` for curl_execute and the constant `"n/a"` for jq_query (the JQ_QUERY_HOSTNAME_LABEL constant has a comment explaining why). Both also pass `wrap` and `hostname` *into* `executeWithHooks` so the hook-executor can route a `beforeRequest` short-circuit through the same wrap.
- **`src/lib/extensible/hook-executor.ts`** — `executeWithHooks` signature gains two parameters (`wrap`, `hostname`). The `beforeRequest` shortCircuit branch now wraps the synthesised `CallToolResult` before returning. This is the S2 closure: previously a hook that returned `{ shortCircuit, response }` bypassed sanitise/detect/spotlight entirely.
- **`src/lib/schema/generator.ts`** — `GeneratorConfig` gains `enableSpotlighting?: boolean`. `createToolHandler` builds `wrap` once at handler construction and calls `wrap(result, safeHostname(url))` after `executeCurlRequest`. `src/lib/api-server.ts` propagates `mergedConfig.enableSpotlighting` into `generatorConfig` so the YAML path honours the user-supplied flag.
- **`src/lib/extensible/mcp-curl-server.ts`** — `registerToolsOnServer` now wraps every entry in `_customTools` with `wrap(result, "custom")` before passing to `server.registerTool`. Both user-supplied custom tools and YAML-derived custom tools (which flow through `registerCustomTool` via `createApiServer`) are covered by this loop. YAML tools are double-wrapped (inner wrap inside `createToolHandler` with the real hostname; outer wrap at registration with `"custom"` label) but the symbol-tag idempotence makes the outer call a no-op. This deliberate redundancy means the YAML path always uses the most-specific hostname for the per-host throttle.

### Tests

- **New: `src/lib/response/post-processor.test.ts`** — 21 cases across six describe blocks: basic shape, sanitisation/detection, spotlighting (per-message UUID assertions), idempotence (including spread-loses-tag regression guard and a `vi.spyOn` call-count assertion that the second wrap call doesn't re-run `sanitizeAndDetect`), error handling (try/catch + wrap-error log assertion), and content-shape edge cases (multi-part, non-string text, non-array content).
- **New: `src/lib/security/wrap-error-logger.test.ts`** — 11 cases covering log format, message non-leakage, throttle, hostname normalisation, fallback to `UnknownError`, and cleanup eviction.
- **Extended: `src/lib/security/detection-logger.test.ts`** — new describe block `sanitizeAndDetect — detect-on-original ordering (PR-6b / S4)` with 4 cases (sanitise-output assertion, detection on clean text, S4-equivalent assertion, no-log-on-benign-text).
- **Extended: `src/lib/extensible/tool-wrapper.test.ts`** — replaced the old fail-closed test with a multi-part pass-through test, plus four new PR-6b cases covering the 4th asymmetry, injection-detection logging keyed on the request hostname, the WRAPPED idempotence tag, and the S2 hook-short-circuit closure regression.
- **Extended: `src/lib/extensible/mcp-curl-server.test.ts`** — new `PR-6b custom-tool wrap (registerToolsOnServer)` describe block. To exercise the wrap (which only fires after `start()`), the test stubs `createServer` from `server-factory.ts` with a fake `McpServer` whose `registerTool` captures the wrapped handler, then invokes it directly. Five cases: 4th asymmetry sanitisation, injection-detection keyed on `"custom"` label, spotlighting wrap, pre-tagged-result short-circuit, error pass-through.
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
- **YAML tools are wrapped twice.** Look at `createToolHandler` (wraps with real hostname) and `registerToolsOnServer` (wraps with `"custom"`). The outer wrap is a no-op via the Symbol tag. If a future refactor moves the inner wrap somewhere else or removes the tag short-circuit, the outer wrap would either double-process or silently switch to using `"custom"` as the per-host log label. The `vi.spyOn(sanitizeAndDetect)` call-count test in `post-processor.test.ts` is the regression guard.
- **The `executeWithHooks` signature change is a breaking change for any internal caller.** Currently only `tool-wrapper.ts` calls it (verified via grep). If anyone else starts calling it, they need to pass `wrap` and `hostname`. The signature change is documented in the file's JSDoc.
- **Mock setup in `mcp-curl-server.test.ts`'s new PR-6b describe block.** It stubs `createServer` from `server-factory.ts` to inject a fake `McpServer`. If any future refactor changes how the server is constructed (e.g. moves construction inline, adds intermediate wrappers), the stub needs updating. Reviewer should confirm the stub captures the right registration shape.
- **`registerTool` callback type cast.** The custom-tool wrap in `registerToolsOnServer` does `as typeof handler` to satisfy the SDK's `ToolCallback` generic. The wrap closure's actual signature is `(args, extra) => Promise<WrappableResult>` which is structurally compatible but TypeScript can't see that through the index-signature `[key: string]: unknown` on `ToolResult`. The cast is documented but reviewers should confirm it doesn't mask a real type divergence.
- **Pattern deviation: detect-on-original is documented in only two places.** `src/lib.ts §7` (consumer-facing) and `src/lib/security/detection-logger.ts` JSDoc (implementation-facing). If a third caller is added, the trade-off should be documented at the caller's site too.
- **Pre-tagged-result test in `mcp-curl-server.test.ts`.** It manually adds the WRAPPED symbol to the handler return value. This verifies idempotence but depends on `Symbol.for("mcp-curl.wrapped")` staying a stable cross-realm key. If the symbol is ever changed to a unique `Symbol("mcp-curl.wrapped")`, that test breaks AND the cross-realm idempotence breaks. The current `Symbol.for` choice is intentional.

## Known issues and limitations

- **Wrap-error cleanup is not started anywhere yet.** `startWrapErrorCleanup` is exported from `src/lib/security/index.ts` but no caller invokes it. The throttle map grows unbounded by unique hostname per process. In practice the per-process hostname cardinality is low (a server typically talks to a small set of upstreams), so this is a slow leak — but it's still a leak. The matching `startInjectionCleanup` IS wired into `McpCurlServer.start()`; the wrap-error equivalent should be too. **Why deferred:** wiring it would require touching `McpCurlServer.start()` and `shutdown()` in addition to the file-set listed here, and the per-PR file-set discipline of the master plan said PR-6b should stay tight. A follow-up todo is appropriate.
- **`isSpotlightEnvelope` is now only used internally by `applySpotlighting` and by the `sanitize.test.ts` test suite.** It's still exported from `src/lib.ts` (PR-1 added it). Keeping the export is the conservative choice — it's a public API with documented semantics, removing it would be a minor-version break — but a reviewer might want to check whether any consumer depends on it. None in this codebase.
- **The `WRAPPED` symbol is silently lost under `JSON.stringify`/spread.** Documented in a regression test. If a hook ever does `JSON.parse(JSON.stringify(result))` between the wrap and return-to-LLM, the result would be re-wrappable. No current code path does this.
- **Custom-tool hostname is always `"custom"`.** A future API could let callers supply their own label (e.g. when a custom tool wraps a single upstream), but this is YAGNI today — the `[injection-defense] [custom]` channel is already useful as "any custom tool fired".
- **Hook-executor signature change is not isolated behind a feature flag.** Anyone forking this code and patching `hook-executor.ts` independently will hit a merge conflict. The signature change is small (two added params) but it IS a change.
- **The wrap doesn't sanitise non-text content parts.** An image part with embedded EXIF text, or a resource part with malicious URI, would pass through unchanged. The plan's scope was text-content sanitisation; defending other content types is out of scope.
- **`createWrapper` itself is not exported from `src/lib.ts`.** Library consumers can't build their own wrappers. The wrap is applied automatically to every registered tool; consumers only interact with it via `enableSpotlighting`. If a consumer needs to wrap text on their own (outside the MCP tool path), they should compose `sanitizeAndDetect` + `applySpotlighting` directly using the existing public exports. This was a deliberate scope choice — exporting `createWrapper` would multiply our public-API surface for a use case that doesn't exist yet.
- **No benchmark coverage.** The wrap adds: one symbol read on every call; for non-error / array-content cases, one `.map()` over content + per-text-part `sanitizeAndDetect` (which the curl path was already doing in `processor.ts`) + optional `applySpotlighting`. Net addition for curl_execute is one extra `sanitizeAndDetect` call (the inner `processor.ts` call already ran, so the second pass against already-sanitised text is essentially zero-cost — Unicode-attack-range matches against clean text return immediately). Net addition for jq_query: same. Net addition for custom tools: one full pass (which is the whole point — they had no defence before). The plan's perf-budget framework lands in PR-9.

## Testing summary

- **Test files added:** 2 (`post-processor.test.ts` 21 cases, `wrap-error-logger.test.ts` 11 cases).
- **Test files updated:** 5 (`detection-logger.test.ts` +4, `tool-wrapper.test.ts` rewrote 1, added 4; `mcp-curl-server.test.ts` +5; `schema.test.ts` +5; `processor.test.ts` rewrote 2).
- **Total tests now:** 735 passing, 7 skipped (was 685 / 7 after PR-6a → +50 net).
- **Build:** `npm run build` clean, no TypeScript errors or warnings.
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
