---
title: "Fork → Upstream contribution audit (mcp-pagespeed → mcp-curl)"
status: active
date: 2026-04-30
---

# Fork → Upstream contribution audit

Before splitting `mcp-pagespeed` off `mcp-curl` as an independent project, this document
captures every fork divergence in the vendored `src/lib/` tree that has value for upstream
consumers. Each item is presented as a candidate upstream PR with diff snippets, justification,
and a recommended title.

## Audit scope

- Upstream HEAD inspected: `5f32c85` (mcp-curl `main` as of 2026-04-30, includes PR #20).
- Fork HEAD inspected: this repo's `main` (commit `cbcabb7`).
- Comparison method: per-file `diff <(git show HEAD:<f>) <(git show upstream/main:<f>)` over
  every shared `src/lib/**` path.
- Result: **20 files differ.** 13 are upstream-ahead (security PR #20 — already covered by
  `docs/plans/2026-04-30-feat-cherry-pick-prompt-injection-defense-plan.md`). The remaining
  **7 are fork-ahead and are the subject of this document.**

## Summary

| # | Change | Type | Files | Recommended upstream PR title |
|---|---|---|---|---|
| 1 | Harden `httpOnlyUrl()` to use `new URL().protocol` instead of `.split(":")` | **Security** | `src/lib/utils/url.ts`, `src/lib/utils/url.test.ts` | `fix(security): harden httpOnlyUrl scheme check via WHATWG URL parser` |
| 2 | Consume `httpOnlyUrl()` helper in built-in schemas (deduplicates inline `.refine()`s) | **Security / DRY** | `src/lib/schema/validator.ts`, `src/lib/server/schemas.ts` | `refactor(schema): consume httpOnlyUrl helper in built-in schemas` |
| 3 | Re-export `httpOnlyUrl` from the public barrel | **DX / Extensibility** | `src/lib/index.ts` | `feat(public-api): re-export httpOnlyUrl for custom-tool authors` |
| 4 | Restore `data:` URL rejection regression tests in prompt schemas | **Test coverage** | `src/lib/prompts/api-discovery.test.ts`, `src/lib/prompts/api-test.test.ts` | `test(prompts): restore data: URL rejection regression coverage` |
| 5 | Real-world custom-tool example (`configs/pagespeed.ts`) | **Docs / Examples** | `configs/pagespeed.ts` | `docs(examples): add PageSpeed-Insights custom-tool example` |

**No performance-only divergences** were identified. The fork's perf optimisations
(post-processing Lighthouse JSON down to scores/metrics) live in `configs/pagespeed.ts`, which
is fork-specific business logic and not portable.

---

## 1. Hardened `httpOnlyUrl()` scheme check (Security)

### What

Replace `url.split(":")[0].toLowerCase()` with `new URL(url).protocol`. The split-based check
relies on string parsing that diverges from the WHATWG URL parser used by Node's `fetch`,
SSRF DNS resolver, and the rest of the security layer; the URL-parser-based check is
semantically aligned with what the runtime actually does.

### Why it matters

- **Parser parity with the SSRF layer.** `src/lib/security/ssrf.ts` resolves DNS via the
  WHATWG URL parser (Node's `URL` class). The schema layer's `httpOnlyUrl` check should agree
  with what the network layer will actually parse — otherwise a URL that string-splits to
  `http:` but parses to a different scheme could pass the schema and surprise the SSRF check.
- **`z.url()` accepts `javascript:`, `data:`, `ftp:`** and any other WHATWG-valid scheme. The
  `.refine()` is the *sole* scheme enforcement at the schema layer. Doing it via the same
  parser used downstream removes a class of edge cases (mixed-case schemes, whitespace,
  percent-encoded scheme separators) where the string-split path could disagree with the
  URL parser.
- **Catches malformed-but-still-string-splittable inputs.** `new URL()` throws on inputs
  that have a `:` but aren't valid URLs (e.g. `:::foo`); `.split(":")[0]` happily returns
  the empty string. `z.url()` rejects most of these, but defence in depth is cheap.

### Diff

```diff
 export function httpOnlyUrl(description: string) {
     return z.url().refine(
-        (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
+        (url) => {
+            try {
+                return ["http:", "https:"].includes(new URL(url).protocol);
+            } catch {
+                return false;
+            }
+        },
         { message: "URL must use http or https scheme" }
     ).describe(description);
 }
```

### Test additions (9 cases — `src/lib/utils/url.test.ts`)

The fork adds an explicit `describe("httpOnlyUrl", ...)` block covering valid (`http://`,
`https://`, with paths/queries) and invalid (`ftp://`, `file://`, `data:`, `javascript:`,
non-URL strings, empty string) inputs. Upstream currently has zero `httpOnlyUrl` tests.

### Upstream PR

**Title:** `fix(security): harden httpOnlyUrl scheme check via WHATWG URL parser`

**Body:** Reference `mcp-pagespeed`'s production use; reference the Node `URL` class behaviour
note in WHATWG URL spec. Include the 9-case test block.

---

## 2. Consume `httpOnlyUrl()` helper in built-in schemas (DRY / regression hardening)

### What

`src/lib/schema/validator.ts` and `src/lib/server/schemas.ts` currently re-implement the
scheme check inline via `.refine()` instead of calling the shared `httpOnlyUrl()` helper.
This is a regression — the helper exists, the inlined version drifts, and a fix to one site
needs to be applied in three places.

### Why it matters

- **Eliminates a known regression vector.** When PR #20 (security) updated the response-side
  sanitiser, it didn't touch these inline scheme checks. If a future PR hardens
  `httpOnlyUrl()` (e.g. via item #1 above), the inlined sites silently lag behind.
- **Consistency at the `z.url().refine()` boundary.** Currently the scheme-check error
  message is *almost* the same in three places (`"URL must use…"` vs `"Base URL must
  use…"`) — a downstream consumer parsing error messages could break on the inconsistency.
- **Smaller bundle.** Three identical regex/predicate functions collapse to one.

### Diff (validator.ts)

```diff
+import { httpOnlyUrl } from "../utils/url.js";
 
 // ...
 
-    baseUrl: z.url("Base URL must be a valid URL").refine(
-        (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
-        { message: "Base URL must use http or https scheme" }
-    ),
+    baseUrl: httpOnlyUrl("Base URL (must use http or https)"),
```

### Diff (schemas.ts)

```diff
+import { httpOnlyUrl } from "../utils/url.js";

-    url: z.url("Must be a valid URL")
-        .refine(
-            (url) => {
-                const scheme = url.split(":")[0].toLowerCase();
-                return ["http", "https"].includes(scheme);
-            },
-            { message: "URL must use http or https scheme" }
-        )
-        .describe("The URL to request"),
+    url: httpOnlyUrl("The URL to request"),
```

### Upstream PR

**Title:** `refactor(schema): consume httpOnlyUrl helper in built-in schemas`

Land **after** item #1 — that way the helper-improvement and the sites that benefit go in
together rather than the sites still inlining the old logic at the time of the refactor.

---

## 3. Re-export `httpOnlyUrl` from the public barrel (DX / Extensibility)

### What

`src/lib/index.ts` is the public package barrel. The fork re-exports `httpOnlyUrl` from it;
upstream stopped doing so somewhere between 3.0.0 and current.

### Why it matters

- **Custom-tool authors need it.** Anyone writing a custom tool that takes a URL parameter
  (e.g. an API-call tool with an explicit URL field) needs the same scheme guard as the
  built-in tools. Without the export, they either (a) deep-import from
  `mcp-curl/dist/lib/utils/url`, (b) re-implement (and drift), or (c) accept any
  `z.url()`-valid scheme including `javascript:`/`data:`.
- **Consistent with documented extensibility model.** `docs/custom-tools.md` and
  `docs/api-schema.md` both presume that schema utilities used by built-ins are also
  available to custom code. `httpOnlyUrl` is the highest-value such utility — it's the
  scheme guard, used by *every* URL-accepting built-in.
- **Costs zero.** Pure additive change to the barrel.

### Diff

```diff
+// URL validation helper
+export { httpOnlyUrl } from "./utils/url.js";
+
```

### Upstream PR

**Title:** `feat(public-api): re-export httpOnlyUrl for custom-tool authors`

Lands cleanly on its own; could also be folded into PR #2.

---

## 4. Restore `data:` URL rejection regression tests in prompt schemas (Test coverage)

### What

`src/lib/prompts/api-discovery.test.ts` and `src/lib/prompts/api-test.test.ts` each currently
have a `it("rejects data: URLs", ...)` test in the fork; upstream removed both during the
security PR refactor.

### Why it matters

- **`data:` URL injection is a documented MCP attack vector.** A `data:text/html,<h1>x</h1>`
  URL passes `z.url()` but should be rejected at every URL-accepting schema. Removing the
  regression tests creates a future drift surface (someone refactors the prompt schema, the
  rejection silently breaks).
- **Tiny — 4 lines per test file.** No risk to land.
- **Mirrors item #1's defence-in-depth posture.** The hardened `httpOnlyUrl()` test block
  covers `data:` at the helper level; these prompt-schema tests cover it at the *consumer*
  level. Both tiers belong.

### Diff

```diff
+    it("rejects data: URLs", () => {
+        expect(apiDiscoveryBaseUrlSchema.safeParse("data:text/plain;base64,SGVsbG8=").success).toBe(false);
+    });
+
```

(And the equivalent in `api-test.test.ts` against `apiTestUrlSchema`.)

### Upstream PR

**Title:** `test(prompts): restore data: URL rejection regression coverage`

Lands cleanly. Pair with item #1 if upstream prefers fewer micro-PRs.

---

## 5. PageSpeed-Insights custom-tool example (Docs / Examples) — *optional*

### What

`configs/pagespeed.ts` is a complete, production-quality example of:

- Using `McpCurlServer.configure()` to disable `curl_execute` while keeping `jq_query`.
- Loading API config + input-schema from a YAML file via `generateInputSchema()`.
- Registering a custom tool with handler-side TypeScript post-processing
  (`registerCustomTool({ ... handler: async () => { /* call executeRequest(); reshape JSON; */ } })`).
- Surfacing API-error responses (rate limits, auth failures) directly to the caller.
- Choosing Zod-v4-friendly types for handler-arg destructuring.

Upstream's `docs/custom-tools.md` currently has a synthetic example (`weather_lookup`). A
real-world example shipped in `configs/` would substantially lower the on-ramp for new
custom-tool authors.

### Why it's optional

- The example is PageSpeed-specific (Google API, Lighthouse JSON shape).
- Once the fork splits off, this file lives here and isn't portable verbatim.
- A *redacted* version (~50 lines, no PageSpeed naming) could be contributed instead.

### Suggested upstream form

Submit a sanitised version under `configs/example-custom-tool.ts` plus an extension to
`docs/custom-tools.md`'s "Example: API integration" section. Roughly:

```ts
// configs/example-custom-tool.ts
// Demonstrates registerCustomTool + executeRequest + handler-side post-processing.
// Real production user: github.com/sixees/mcp-pagespeed.
import { McpCurlServer, generateInputSchema, getAuthConfig } from "../src/lib.js";
// ... ~40 lines of redacted PageSpeed code
```

### Upstream PR

**Title:** `docs(examples): add real-world custom-tool example with TypeScript post-processing`

Lower priority than items 1–4. File only after items 1–3 land and the helper API surface is
stable.

---

## Recommended sequencing

```text
Day 0  ──→  Open upstream PRs in this order (all small, independent):
          1. fix(security): harden httpOnlyUrl scheme check via WHATWG URL parser
          2. refactor(schema): consume httpOnlyUrl helper in built-in schemas
          3. feat(public-api): re-export httpOnlyUrl for custom-tool authors
          4. test(prompts): restore data: URL rejection regression coverage

Day +1–7  →  Wait for upstream review/merge. Items 1+4 are independent; 2 depends on 1; 3
             can land in parallel with any of them.

Day +N  ──→  After items 1–4 are merged (or after 2 weeks, whichever first):
          - Cherry-pick upstream PR #20 into mcp-pagespeed per
            docs/plans/2026-04-30-feat-cherry-pick-prompt-injection-defense-plan.md
          - Drop the `upstream` git remote.
          - Bump mcp-pagespeed major (4.0.0) signalling the split.
          - Update README + CLAUDE.md to remove "fork of mcp-curl" framing.
          - Delete preserved-divergence checks from any future internal docs.

Day +N+1 →  (Optional) Submit item 5 if upstream review of 1–4 has been receptive.
```

## What is *not* being contributed back

| Item | Reason |
|---|---|
| `configs/pagespeed.yaml` (PageSpeed API definition) | PageSpeed-specific business logic. |
| `configs/pagespeed-agent-test.ts` (agent harness) | Built around PageSpeed test fixtures. |
| Fork's commit-message convention (plain lowercase imperative) | Matter of taste; upstream uses a conventional-commit variant. |
| Fork's tag convention (no `v` prefix) | Matter of taste; upstream pattern is its own. |
| Fork's CLAUDE.md content | PageSpeed-specific. |
| Fork's docs/plans/ directory | Project planning artefacts; not library-level. |

## After the split

Once items 1–4 are merged upstream and the cherry-pick of PR #20 is complete, this fork
should:

1. **Drop the `upstream` git remote:** `git remote remove upstream`.
2. **Bump major to 4.0.0** to signal the split.
3. **Rewrite CLAUDE.md / README.md** to drop "fork of mcp-curl" framing — present as a
   standalone PageSpeed-Insights MCP server, with a credit-line acknowledging mcp-curl as
   the original codebase.
4. **Vendor `src/lib/` as fork-owned code** — no further upstream syncs are planned.
5. **Delete `docs/upstream-contributions.md`** (this file) once contributions are merged
   upstream, since the audit will be historical.

## References

- Upstream HEAD reviewed: `5f32c85` (`https://github.com/sixees/mcp-curl/commit/5f32c85`).
- Cherry-pick plan for upstream PR #20: `docs/plans/2026-04-30-feat-cherry-pick-prompt-injection-defense-plan.md`.
- Fork's hardened helper: `src/lib/utils/url.ts:21-32`.
- Fork's helper-consumer sites: `src/lib/schema/validator.ts:91`, `src/lib/server/schemas.ts:12`.
- Fork's barrel export: `src/lib/index.ts:30-32`.
- Fork's added tests: `src/lib/utils/url.test.ts:45-93`.
