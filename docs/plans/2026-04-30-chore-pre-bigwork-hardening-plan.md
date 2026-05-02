---
title: "Pre-bigwork hardening — close all open todos + adopt deferred upstream improvements"
type: chore
status: active
date: 2026-04-30
---

# Pre-bigwork hardening — close all open todos + adopt deferred upstream improvements

## Enhancement Summary

**Deepened on:** 2026-04-30
**Sections enhanced:** 12 (Overview, Proposed Solution, A1, B3, B4, B5, B7-sub-1-3, B7-sub-4-5, B8, B9, C1, Non-Functional Requirements, WBS/PR Plan, Risks)
**Research/review agents used:** plan-critic, security-sentinel, typescript-reviewer, architecture-strategist, code-simplicity-reviewer, performance-oracle, pattern-recognition-specialist, MCP-SDK research, Zod-v4 research, prompt-injection 2026 SOTA research (10 agents in parallel)

### Key Improvements (HIGH-severity corrections)

1. **B4 diff is broken at runtime — replaced.** Three independent agents (TypeScript reviewer, security sentinel, Zod research via `node_modules/zod/v4/classic/schemas.js:74-77`) converged on the same finding: in Zod v4, `description` lives in `z.globalRegistry` (a `WeakMap`), **not** on `_def`. Mutating `_def.description` is a runtime no-op — `.parse()`, `.toJSONSchema()`, and downstream consumers ignore it. The corrected approach rebuilds the shape via `field.describe(sanitized)` (which clones + re-registers) and returns a **new** `ZodObject`. The `unwrap()` traversal is also unnecessary — `.describe()` on the outer wrapper handles `.optional()`/`.default()` correctly.
2. **B9 has a public-API bypass.** `validateApiSchema()` is exported and callable independently of `loadApiSchema()`. Sanitization must move **into** `validateApiSchema()` (not just the loader) so every public entry point preserves the invariant. Type-brand dropped (TypeScript + simplicity + plan-critic converge: more friction than safety value).
3. **Fourth trust-boundary asymmetry surfaced.** Architecture review found `tool-wrapper.ts` only calls `maybeApplySpotlighting`; it never invokes `sanitizeResponse` or `detectInjectionPattern`. Custom-tool and YAML-tool output is therefore spotlighted but not sanitized/detected — silent asymmetry the plan didn't list. B3's helper expands from `wrapWithSpotlighting` to **`wrapWithDefence`** running all three.
4. **PR-6 splits into PR-6a (B9) + PR-6b (B3).** Combining sanitise-when (B9) with spotlighting-where (B3) created an oversized, multi-concern review. WBS shows two PRs of bounded scope each.
5. **B5 length cap rejects real JWTs.** 256-char cap rejects RSA-256 JWTs and OIDC tokens (commonly 400–900+ chars). Raised to 4096. Plus: use `createConfigError()` (existing helper, pattern reviewer), move `MAX_AUTH_TOKEN_LENGTH` to `config/limits.ts` and `PRINTABLE_ASCII` to `config/security/validation.ts` (repo convention), never echo token in errors.
6. **Performance threshold ±5% is unachievable** — but the originally-revised ±15%/±25%/±50% numbers are also speculative until we measure. **Measurement-first protocol (per technical-review C1):** after PR-1 lands, run a benchmark on `main` and record p50/p95 in Validation Pass. Set CI thresholds at **+20% above measured p95** in PR-9 (single round). No threshold lands in CI before measurement. Background context retained for sizing intuition only: NFKC on a 1 MB body costs 25–70 ms (15–40 MB/s on V8); three additional regex passes add another 5–15%; worst case is in the tens of percent, not a few percent — the "±5%" target was unachievable from the start.
7. **B7-sub-1-3 misses 2026 attack ranges.** Variation Selectors (U+FE00–U+FE0F, U+E0100–U+E01EF — "Sneaky Bits"), U+2062 INVISIBLE TIMES, U+2064 INVISIBLE PLUS, U+2800 BRAILLE PATTERN BLANK, U+061C ARABIC LETTER MARK, U+180B–U+180D Mongolian VS — all documented 2025–2026 prompt-injection vectors not in the plan's range list.
8. **B7-sub-4-5 NFKC alone is insufficient for Cyrillic/Greek homoglyphs.** Per UTS #39, NFKC does **not** normalize most Cyrillic/Greek look-alikes. The Unicode-recommended technique is `skeleton()` from `confusables.txt`. Plan adds a follow-up note: NFKC closes width-variant + ASCII-mappable cases; UTS #39 skeleton can land as a future iteration if the per-hostname log signal shows Cyrillic-homoglyph attacks in the wild.
9. **B8 regex is ReDoS-vulnerable.** `<script\b[^>]*>[\s\S]*?</script>` is Snyk's textbook ReDoS example. Self-healing bypass: `<scr<script>ipt>alert(1)</scr</script>ipt>`. Numeric character references (`&#x73;cript`) survive. Plan now adds: 256 KB length cap, fixed-point iteration (`while(changed)`), HTML entity decode pass, and a worker-bound 100 ms timeout. Also: block markdown **links** (not just images) — same exfil class.
10. **C1 needs a refresh.** Latest alpha is `2.0.0-alpha.2` (not alpha.1). 2.0 ships with a 9-item breaking-change list and a package split (`@modelcontextprotocol/{server,client,node,express,hono,fastify}`). 1.x security backports already inherited (CVE-2026-0621 UriTemplate ReDoS in 1.25.2; GHSA-345p-7cg4-v4c7 transport-sharing leakage in 1.26.0).

### New Considerations Discovered

- **Document-internal contradiction:** §"Proposed Solution" line 47 says sources are deleted "as part of this planning step," but WBS item 15 lists deletion as the final step gated on PRs 1–14. Resolved: WBS is the source of truth — delete after PRs ship. Line 47 corrected.
- **B2 README example is somewhat softened by B4 auto-sanitization** (which catches top-level field descriptions). The README pattern remains the recommended idiom for **dynamically-built** schemas (constructed across modules, untyped intermediate stages) — keep, with wording softened from "required" to "defensive at the call site."
- **Risk register additions:** ReDoS in script/style strip; worst-case +55% sanitisation cost on 10 MB responses; Standard-Schema readiness audit for B4 (typing already accepts `z.ZodObject<z.ZodRawShape>` which Zod v4 emits as Standard Schema-compatible — no work needed today).

## Review history (technical-review pass — applied 2026-05-01)

A `/sixees-workflow:technical-review` pass with three independent reviewers (code-simplicity, architecture-strategist, security-sentinel) surfaced 36 findings against the deepened plan. The user elected "apply all." All actionable findings have been **folded directly into the body sections**: B3 (PR-6b), B4 (PR-5), B9 (PR-6a), §Non-Functional Requirements, and §Work Breakdown / PR Plan. Each affected body section is stamped "Revised 2026-05-01 per technical-review pass."

The full finding list and disposition is preserved in the **Review history appendix** at the end of this document for traceability.

## Overview

`mcp-curl` carries 9 open todos under `docs/todos/` (all from PR-#20 / PR-#21 / PR-#22 review feedback) and 4 deferred upstream-bound improvements catalogued in `docs/upstream-contributions.md`. Before starting the next major piece of work, we want the codebase buttoned up: no half-applied review feedback, the security-helper trust boundary stronger and self-consistent, and the public extension API symmetric. This plan consolidates **13 actionable items** (9 todos + 4 upstream items; the 5th upstream item is a fork-only example and is dropped) into **9 small, independent PRs** (after deep-plan review split the original PR-6 into PR-6a + PR-6b for review focus), plus one explicit *non-action* finding on the MCP SDK that the team should be aware of when scoping the next round of work.

After the audit:

- **All 9 todos are still applicable** — every referenced file still has the documented gap.
- **4 of 5 upstream-contribution items are still applicable** — the `httpOnlyUrl` helper on `main` is still the un-hardened `.split(":")[0]` form; the inline `.refine()` callsites in `validator.ts` and `schemas.ts` still drift from the helper; the public barrel `src/lib.ts` still lacks `httpOnlyUrl`; and the prompt-schema regression tests still don't cover `data:` URLs. **Upstream item #5** (PageSpeed-Insights example file) is fork-specific and dropped — not portable to upstream verbatim, and the synthetic `weather_lookup` example in `docs/custom-tools.md` already covers the same pedagogical ground.
- **`@modelcontextprotocol/sdk` is already at `^1.29.0`** — the latest published stable. The SDK's *next* major (`2.0.0-alpha.2`, 2026-04-01) is in development with a 9-item breaking-change list and a package split into `@modelcontextprotocol/{server,client,node,express,hono,fastify}` (Standard Schema replacing Zod-specific tool/prompt registration; unknown-tool/unknown-resource error codes change to JSON-RPC `-32602` / `-32002`). Nothing to do today, but item **C1** below captures the forward-compat posture this plan should not regress.

After this plan executes, `docs/todos/` and `docs/upstream-contributions.md` are deleted — the plan and its referenced PRs become the single source of truth.

## Problem Statement

The codebase has accumulated review-derived hardening work that was deferred from prior PRs to keep them shippable. Each individual gap is small, but together they form three consistent themes:

1. **Trust-boundary asymmetry.** The same security primitive (sanitization, scheme-allowlist, spotlighting) is enforced differently along different code paths. Examples: the YAML schema layer carries un-sanitized strings until each downstream consumer remembers to call `sanitizeDescription()`; the `enableSpotlighting` flag wraps built-in tool responses but not YAML-generated ones; `httpOnlyUrl()` is hardened in one fork but the inlined `.refine()` copies in `validator.ts`/`schemas.ts` still split on `":"` like before.
2. **Public extension API gaps.** Library consumers building custom tools cannot replicate the server's internal hardening — `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`, and the helper `httpOnlyUrl` are not on the public barrel, so authors either deep-import (API-stability hazard) or reimplement (drift hazard).
3. **Coverage gaps.** No unit tests for `executeJqQuery`; the `httpOnlyUrl` helper has zero direct tests; prompt schemas dropped their `data:` URL regression tests in a prior refactor; the injection-defense pattern set has documented bypass classes (whitespace-padding via tab/newline, homoglyph, leetspeak, gap-padding > 20 chars, synonym variants).

Doing this work now — before the "big piece" begins — gives that future work a stable, well-instrumented foundation and means review of the next feature isn't competing with leftover hardening commentary.

## Proposed Solution

Land **nine focused PRs** that close the 13 actionable items, in an order that lets early small wins flow first and isolates the higher-risk security-detection work last (so it can absorb the most review attention without blocking everything else):

1. **PR-1** — URL/scheme helper hardening + public-barrel symmetry (5 items: A1 + A2 + A3 + A4 + B6).
2. **PR-2** — `executeJqQuery` unit test coverage (1 item: B1).
3. **PR-3** — README example for sanitizing externally-sourced `inputSchema` field descriptions (1 item: B2).
4. **PR-4** — `authToken` printable-ASCII validation + length cap (1 item: B5).
5. **PR-5** — Auto-sanitize Zod field descriptions on `registerCustomTool()` (1 item: B4).
6. **PR-6a** — YAML schema sanitize-at-load (sanitise-when concern) (1 item: B9).
7. **PR-6b** — Defence-in-depth parity for YAML/custom-tool output: spotlighting + sanitise + detect (where concern) (1 item: B3, expanded scope — 4th asymmetry).
8. **PR-7** — Response-side sanitization expansion: HTML `<script>`/`<style>` stripping (ReDoS-hardened) + markdown image/link beacons + impactful injection-defense gaps (whitespace-padding for tabs/newlines, missing Unicode ranges including Variation Selectors and Sneaky Bits, threshold review) (2 items: B7 sub-1-3 + B8).
9. **PR-8** — Detection-pattern expansion (observability-only): NFKC normalisation, widened bounded wildcards, synonym variants, missing homoglyph coverage (1 item: B7 sub-4-5).

> **Why the PR-6 split (architecture review HIGH).** PR-6 originally combined two orthogonal concerns: B9's sanitise-when ("once at load vs many times on read") and B3's defence-where ("custom-tool output skips spotlighting/sanitise/detect"). One reviewer would need expertise in both load-time invariants and output-defence semantics. Splitting into PR-6a (B9 — single layer) and PR-6b (B3 — single layer) keeps each diff under ~5 files of net-new code and lets each PR review on a single mental model.

Then delete `docs/todos/` and `docs/upstream-contributions.md` once all 8 PRs are merged. **WBS item 15 is authoritative on the deletion timing** — it lands as the final cleanup commit, gated on PRs 1–14 having shipped. (An earlier draft of this plan considered deleting the sources up-front, but that loses the per-item provenance in mid-flight; see WBS item 15 for the agreed cadence.) The plan body below carries the full diff snippets, justifications, and acceptance criteria for each item, so the originals can be removed cleanly once their content is fully absorbed.

## Technical Approach

### Architecture

No new modules. All work lands within existing layers per the module map in `CLAUDE.md` / `docs/architecture/architecture.md`:

- `src/lib/utils/sanitize.ts` — sanitization & detection primitives (B7, B8)
- `src/lib/utils/url.ts` — URL helpers (A1, A3)
- `src/lib/utils/url.test.ts` — direct helper tests (A1)
- `src/lib/schema/{loader.ts, validator.ts, generator.ts, types.ts}` — YAML schema layer (A2, B9)
- `src/lib/server/schemas.ts` — built-in tool input schemas (A2)
- `src/lib/extensible/{mcp-curl-server.ts, tool-wrapper.ts}` — extension surface (B3, B4)
- `src/lib/transports/http.ts` + `src/lib/types/public.ts` — auth-token boundary (B5)
- `src/lib/response/processor.ts` — response sanitization pipeline (B8)
- `src/lib/tools/jq-query.test.ts` — new test file (B1)
- `src/lib/prompts/{api-discovery,api-test}.test.ts` — restored data: URL coverage (A4)
- `src/lib.ts` — public barrel symmetry (A3, B6)
- `README.md`, `docs/custom-tools.md` — docs (B2)

### Implementation Phases

#### Phase 1 — Helper consolidation & public surface (PR-1, PR-2, PR-3, PR-4)

Small, low-risk PRs that improve the substrate. Land first so subsequent PRs build on a self-consistent helper API.

#### Phase 2 — Trust-boundary repairs (PR-5, PR-6)

Custom-tool and YAML-tool registration paths brought into parity with built-in-tool sanitization & spotlighting. Each PR is medium complexity but tightly scoped.

#### Phase 3 — Injection-defense expansion (PR-7, PR-8)

The most security-sensitive work. Split into impactful (PR-7 — affects what reaches the LLM) and observability (PR-8 — only changes what we log) so review can prioritise correctly.

### Detail of each item

> Each item carries: **What**, **Why**, **Diff sketch**, **Tests**, **Acceptance criteria**.

---

#### A1 — Harden `httpOnlyUrl()` via WHATWG URL parser  *(PR-1)*

**What.** Replace the string-split scheme check in `src/lib/utils/url.ts:21-26` with a `new URL(url).protocol` parser-based check, mirroring how `security/ssrf.ts` and Node's `fetch` resolve URLs.

**Why.**

- **Parser parity with the SSRF layer.** `src/lib/security/ssrf.ts` resolves DNS via the WHATWG URL parser. The schema-layer `httpOnlyUrl` check should agree with what the network layer will actually parse — a URL that string-splits to `http:` but parses to a different scheme could pass the schema and surprise the SSRF check.
- **`z.url()` accepts `javascript:`, `data:`, `ftp:`** and any other WHATWG-valid scheme. The `.refine()` is the *sole* scheme enforcement at the schema layer.
- **Catches malformed-but-still-string-splittable inputs.** `new URL()` throws on inputs that have a `:` but aren't valid URLs (e.g. `:::foo`); `.split(":")[0]` happily returns the empty string.

**Diff (`src/lib/utils/url.ts`).**

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

**Tests (`src/lib/utils/url.test.ts`).** Add a `describe("httpOnlyUrl", …)` block covering ≥ 9 cases:

- Valid: `http://example.com`, `https://example.com`, `https://example.com/path?query=1`
- Invalid: `ftp://example.com`, `file:///etc/passwd`, `data:text/plain;base64,SGVsbG8=`, `javascript:alert(1)`, `not-a-url`, `""`

**Acceptance criteria.**

- [ ] `httpOnlyUrl()` rejects every non-http/https scheme that `z.url()` would otherwise accept.
- [ ] Existing tests in `validator.test.ts`, `mcp-curl-server.test.ts`, prompt schema tests still pass.
- [ ] New `describe("httpOnlyUrl")` block covers ≥ 9 cases including `data:`, `javascript:`, `file:`, `ftp:`.

**Research Insights (added 2026-05-01).**

- **WHATWG `URL.protocol` semantics confirmed safe.** The parser returns `"http:"` or `"https:"` for matching schemes (note trailing colon — important: list match must include the colon). It throws `TypeError` for malformed inputs, including the `:::foo` edge case the existing `.split(":")[0]` form silently passes as empty.
- **Add three extra adversarial cases** to the test block: `httpx:` (look-alike), `https::` (double-colon parser quirk), `https://[::1]/` (IPv6 host — should pass, ensure helper doesn't reject IPv6 because of the embedded colons).
- **TypeScript reviewer GREEN** — typing is correct (`z.url()` returns `ZodURL`; `.refine()` preserves type narrowing).

---

#### A2 — Consume `httpOnlyUrl()` helper in built-in schemas  *(PR-1)*

**What.** Replace the inline `.refine()` scheme checks in `src/lib/schema/validator.ts:90-93` and `src/lib/server/schemas.ts:11-19` with calls to the shared `httpOnlyUrl()` helper.

**Why.**

- **Eliminates a known regression vector.** When PR-#20 (security) updated the response-side sanitiser, it didn't touch these inline scheme checks. If A1 hardens `httpOnlyUrl()`, the inlined sites silently lag behind.
- **Consistency at the `z.url().refine()` boundary.** The error message is *almost* the same in three places (`"URL must use…"` vs `"Base URL must use…"`) — a downstream consumer parsing error messages could break on the inconsistency.
- **DRY.** Three identical predicate functions collapse to one.

**Diff (`src/lib/schema/validator.ts`, around line 90).**

```diff
+import { httpOnlyUrl } from "../utils/url.js";

 // ...

-    baseUrl: z.url("Base URL must be a valid URL").refine(
-        (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
-        { message: "Base URL must use http or https scheme" }
-    ),
+    baseUrl: httpOnlyUrl("Base URL (must use http or https)"),
```

**Diff (`src/lib/server/schemas.ts`, around line 11).**

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

**Acceptance criteria.**

- [ ] No remaining `.split(":")[0]` scheme check in `src/lib/`.
- [ ] `npm test` passes (the existing `validator.test.ts`, `schemas.test.ts`, `http.test.ts`, `mcp-curl-server.test.ts` should still pass).
- [ ] An integration smoke test confirms `data:` and `javascript:` URLs are rejected by both `apiInfoSchema.baseUrl` and `CurlExecuteSchema.url`.

---

#### A3 — Re-export `httpOnlyUrl` from public barrel  *(PR-1)*

**What.** Add `httpOnlyUrl` to `src/lib.ts` so custom-tool authors can adopt the same scheme guard the built-ins use without deep-importing.

**Why.**

- **Custom-tool authors need it.** Anyone writing a custom tool that takes a URL parameter needs the same scheme guard. Without the export, they either deep-import from `mcp-curl/dist/lib/utils/url`, re-implement (and drift), or accept any `z.url()`-valid scheme including `javascript:`/`data:`.
- **Consistent with documented extensibility model.** `docs/custom-tools.md` and `docs/api-schema.md` both presume that schema utilities used by built-ins are also available to custom code.
- **Pure additive change.**

**Diff (`src/lib.ts`).**

```diff
 // Sanitization helpers (callers need these to defend against prompt injection
 // in externally-sourced tool metadata — see docs/custom-tools.md).
 export { sanitizeDescription, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "./lib/utils/index.js";
+
+// URL validation helper for custom tool authors that take URL parameters.
+export { httpOnlyUrl } from "./lib/utils/index.js";
```

**Tests.** No new tests — exposed through existing test coverage. Add a one-line note in `docs/custom-tools.md` showing `httpOnlyUrl("Target URL")` in the URL-parameter example block.

**Acceptance criteria.**

- [ ] `import { httpOnlyUrl } from "mcp-curl"` resolves at the package public surface.
- [ ] `dist/lib.d.ts` exports the symbol after `npm run build`.

---

#### A4 — Restore `data:` URL rejection regression tests in prompt schemas  *(PR-1)*

**What.** Add a `data:` URL rejection test to both `src/lib/prompts/api-discovery.test.ts` and `src/lib/prompts/api-test.test.ts`.

**Why.** `data:` URL injection (e.g. `data:text/html,<h1>x</h1>`) passes `z.url()` but should be rejected at every URL-accepting schema. The current test suite covers `ftp:`, `file:`, `javascript:` but **not** `data:` — leaving a regression-detection gap. Mirrors A1's defence-in-depth posture (helper-level coverage in A1; consumer-level coverage here).

**Diff (`src/lib/prompts/api-discovery.test.ts`, append before the closing `});`).**

```diff
+    it("rejects data: URLs", () => {
+        expect(apiDiscoveryBaseUrlSchema.safeParse("data:text/plain;base64,SGVsbG8=").success).toBe(false);
+    });
```

(And the equivalent in `api-test.test.ts` against `apiTestUrlSchema`.)

**Acceptance criteria.**

- [ ] Both prompt test files now reject `data:` URLs.
- [ ] No other prompt test was modified.

---

#### B6 — Re-export spotlighting helpers from public barrel  *(PR-1)*

**What.** Re-export `applySpotlighting`, `sanitizeResponse`, and `detectInjectionPattern` from `src/lib.ts`.

**Why.** A custom tool author who wants to honour the user's `enableSpotlighting` config has no public surface to do so today. They'd have to import from internals (API-stability hazard) or reimplement (drift hazard).

**Contract documented:** callers wrapping external content for the LLM should sanitise + spotlight using the same helpers the server uses internally, keying the spotlight by `randomUUID()` per request.

**Diff (`src/lib.ts`).**

```diff
 // Sanitization helpers (callers need these to defend against prompt injection
 // in externally-sourced tool metadata — see docs/custom-tools.md).
 export { sanitizeDescription, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "./lib/utils/index.js";
+
+// Response-side defence helpers — callers emitting external content (HTTP body,
+// file content, third-party API response) should sanitise+spotlight to honour
+// the same trust boundary the server enforces on built-in tools.
+export { applySpotlighting, sanitizeResponse, detectInjectionPattern } from "./lib/utils/index.js";

 // URL validation helper for custom tool authors that take URL parameters.
 export { httpOnlyUrl } from "./lib/utils/index.js";
```

**Docs.** Add a short "Replicating the response-side defence" subsection to `docs/custom-tools.md` showing the call shape:

```typescript
import { sanitizeResponse, applySpotlighting, detectInjectionPattern } from "mcp-curl";
import { randomUUID } from "node:crypto";

const sanitized = sanitizeResponse(externalContent);
if (detectInjectionPattern(sanitized)) {
    console.error(`[injection-defense] [${hostname}] InjectionDetected`);
}
const wrapped = config.enableSpotlighting
    ? applySpotlighting(sanitized, randomUUID())
    : sanitized;
```

**Acceptance criteria.**

- [ ] All four helpers (`applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`, plus the existing `sanitizeDescription`) are listed in `dist/lib.d.ts` after build.
- [ ] `docs/custom-tools.md` shows the recommended call pattern with `randomUUID()` per request.

---

#### B1 — Unit tests for `executeJqQuery` in `jq-query.ts`  *(PR-2)*

**What.** Add `src/lib/tools/jq-query.test.ts` with focused unit tests for `executeJqQuery()` covering path validation, error branches, and edge cases.

**Why.** `executeJqQuery()` is exercised only through integration paths today (through `mcp-curl-server.test.ts` etc.). Direct unit-test coverage makes regressions in path-validation + symlink + traversal logic more obvious in CI.

**Test scenarios.**

- Valid file path within allowed dirs → returns content
- Path outside allowed dirs → throws security error (returned as `isError: true`)
- Path traversal (`..`) → rejected
- Symlink resolution failure → returns `isError: true`
- File read error (permissions, missing) → returns `isError: true` with sanitized error message
- jq filter applied to file content → correct output
- `save_to_file: true` + small content → still saves to file, returns acknowledgment
- Output exceeds `max_result_size` → auto-saves, returns acknowledgment
- Sanitization of jq result fires (e.g. `​` in input field surfaces a clean filtered output)
- Injection detection fires on filtered content (observability — log assertion via `vi.spyOn(console, "error")`)

**Implementation note.** Use `tmpdir()` for fixture files to avoid mocking `fs` — keeps tests realistic and exercises the real `validateFilePath()` symlink resolution. Mock only `console.error` for log assertions and (sparingly) the filesystem-read failure path via a non-existent path.

**Acceptance criteria.**

- [x] `src/lib/tools/jq-query.test.ts` exists with ≥ 10 test cases.
- [x] Coverage of `executeJqQuery()` in `npm test -- --coverage` rises measurably (no formal threshold, but every error branch should have at least one test).
- [x] No file outside the test fixture directory is created.

---

#### B2 — README example for sanitizing externally-sourced `inputSchema` field descriptions  *(PR-3)*

**What.** Add a code example to `README.md` showing the pattern for sanitizing `.describe()` strings sourced from external input. Cross-link from the README to `docs/custom-tools.md`'s existing example.

**Why.** `McpCurlServer.registerCustomTool()` already sanitises the top-level `title` and `description`. It does **not** reach into `inputSchema` — `.describe()` strings on individual Zod fields can carry the same Unicode-attack characters that `sanitizeDescription()` strips. Tool consumers (LLM clients) read field-level descriptions when deciding how to populate arguments, so an attacker who controls a field description has the same leverage as one who controls the tool description. The README has a custom-tool section but no example showing where to apply `sanitizeDescription()`.

**Diff (`README.md`, custom-tools section).** Append:

````markdown
### Sanitising externally-sourced field descriptions

`registerCustomTool()` sanitises `title` and `description` automatically. It does **not** reach
into `inputSchema` — apply `sanitizeDescription()` to any `.describe()` string sourced from
outside your own code (database, remote API, user-authored YAML).

```typescript
import { z } from "zod";
import { McpCurlServer, sanitizeDescription } from "mcp-curl";

const fieldMeta = await fetchFieldDescriptionsFromDb();

server.registerCustomTool(
    "search_records",
    {
        title: "Search records",            // sanitized internally
        description: "Search the catalog.", // sanitized internally
        inputSchema: z.object({
            q: z.string().describe(sanitizeDescription(fieldMeta.q)),
            limit: z.number().int().min(1).max(100)
                .describe(sanitizeDescription(fieldMeta.limit)),
        }),
    },
    handler
);
```

For trusted internal strings, no sanitisation is required. See [`docs/custom-tools.md`](./docs/custom-tools.md#validating-external-inputs) for the full discussion.
````

**Note.** This README block becomes redundant once **B4** lands (auto-sanitisation of Zod field descriptions in `registerCustomTool()`). Keep B2 anyway — sanitising at the call site remains the recommended pattern for **callers building Zod schemas dynamically before registration** (e.g. constructing the schema in another module). Update the wording in B4's PR to reflect that the call-site pattern is "defensive belt-and-braces" rather than "required".

**Acceptance criteria.**

- [x] README has a sanitisation example for `inputSchema` field descriptions.
- [x] Cross-link to `docs/custom-tools.md` exists.

---

#### B5 — `authToken` printable-ASCII validation + length cap  *(PR-4)*

**What.** Validate the `authToken` config value (and the `MCP_AUTH_TOKEN` env variant) at HTTP transport startup. Reject tokens that contain non-printable ASCII or exceed **4096** characters (revised from 256 — see Research Insights). Do **not** sanitise — fail loudly at startup so a misconfigured operator sees the error immediately.

**Why (current state).** `McpCurlConfig.authToken` (and the env equivalent) flows directly into a `Bearer ${authToken}` Authorization header check in `transports/http.ts:139-150`. Printable ASCII characters (including `"`, `;`, newlines after parsing, etc.) pass through unmodified. The attack surface is small (operator-controlled at startup), but the cost of validating is trivial and removes a class of "weird tokens silently misbehave" bugs.

**Decision the team should make in this PR.**

The authToken value is operator-controlled. Risks if invalid:

- A token with `\r\n` could (theoretically) split the response we generate (we don't echo it, but defence in depth is cheap).
- A token longer than 4096 chars is almost certainly a misconfiguration (pasted JSON object, full curl-`-H` literal, accidentally concatenated secrets).
- A token with `\0` or other C0 controls is almost certainly a paste error.

**Choice.** Validate at startup. Reject via `createConfigError()` (existing helper in `src/lib/utils/error.ts`) with a clear error. Length cap **4096** (covers RSA-256 JWTs at 700–900 chars, OIDC ID tokens at 1500–2500 chars, encrypted JWE tokens at up to ~4 KB; below the 8 KB HTTP header line-limit).

**Constants placement (repo convention).**

- `MAX_AUTH_TOKEN_LENGTH = 4096` → `src/lib/config/limits.ts` (alongside other resource limits).
- `PRINTABLE_ASCII = /^[\x20-\x7E]+$/` → `src/lib/config/security/validation.ts` (alongside other validation patterns).
- `validateAuthToken()` stays in `src/lib/transports/http.ts` (close to its caller) but imports both constants.

**Diff sketch (split across files; see constants placement above).**

```diff
// src/lib/config/limits.ts (append)
+export const MAX_AUTH_TOKEN_LENGTH = 4096;

// src/lib/config/security/validation.ts (append)
+// Operator-supplied auth tokens — printable ASCII only. Excludes C0/C1 controls
+// (CRLF, NULL, high-bit). Headers are validated against this on startup.
+export const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

// src/lib/transports/http.ts (before createAuthMiddleware)
+import { MAX_AUTH_TOKEN_LENGTH } from "../config/limits.js";
+import { PRINTABLE_ASCII } from "../config/security/validation.js";
+import { createConfigError } from "../utils/error.js";
+
+/**
+ * Validate operator-supplied auth token at startup. Rejects tokens that contain
+ * non-printable ASCII (including CRLF, NULL, and high-bit control bytes) or
+ * exceed MAX_AUTH_TOKEN_LENGTH characters. Throws synchronously so a
+ * misconfigured operator sees the error before the server starts accepting
+ * connections. NEVER echoes the token value in error messages.
+ */
+export function validateAuthToken(token: string | undefined): void {
+    if (token === undefined || token === "") return;
+    if (token.length > MAX_AUTH_TOKEN_LENGTH) {
+        throw createConfigError(
+            "MCP_AUTH_TOKEN",
+            `[length=${token.length}]`,
+            `exceeds maximum ${MAX_AUTH_TOKEN_LENGTH} characters`
+        );
+    }
+    if (!PRINTABLE_ASCII.test(token)) {
+        throw createConfigError(
+            "MCP_AUTH_TOKEN",
+            "[redacted]",
+            "must contain only printable ASCII characters (0x20–0x7E)"
+        );
+    }
+}
```

**Apply at startup.** In both `runHTTP()` and `McpCurlServer.startHttp()`, call `validateAuthToken(authToken)` immediately before `createHttpApp()`.

**Tests (`src/lib/transports/http.test.ts`).** Add cases:

- Empty / undefined token → no throw.
- 4096-char printable ASCII → no throw.
- 4097-char token → throws with length-bound message; **token value is NOT in the error string** (assert via `vi.spyOn` on whatever logger touches it; assert error.message contains `[length=4097]` not the body).
- Token containing `"\n"`, `"\r"`, `"\0"`, `"\x7F"` → throws with charset message; token redacted in error.
- Token containing high-bit char (e.g. `"é"`) → throws with charset message; token redacted.
- **Real-world JWT fixture (~800 chars, RSA-256)** → no throw (regression: the old 256-char cap rejected this).
- **Real-world OIDC ID token fixture (~1800 chars)** → no throw.

**Acceptance criteria.**

- [x] `validateAuthToken` is called from both transport entry points before binding.
- [x] An invalid token causes `start("http")` to reject with a clear message; the HTTP server is not bound.
- [x] Token value is never echoed in error messages or logs (audit by `grep '${token' src/`).
- [x] Existing HTTP transport tests still pass.

**Research Insights (added 2026-05-01).**

- **256-char cap was too tight (security review HIGH).** Real RSA-256 JWTs are commonly 400–900+ characters; OIDC ID tokens routinely exceed 1500. Encrypted JWE tokens can hit ~4 KB. The original 256 cap would have rejected the most common production auth flows, generating a false-positive class of breakage on upgrade.
- **Use the existing `createConfigError()` helper (pattern review).** `src/lib/utils/error.ts` already provides `createConfigError(name, value, reason)`. Re-using it keeps error formatting consistent with the rest of the config-validation layer (`MCP_CURL_OUTPUT_DIR`, `MCP_CURL_SESSION_TIMEOUT`, etc.).
- **Constants belong in `config/`, not the transport file (pattern review).** Repo convention groups numeric resource limits in `src/lib/config/limits.ts` and validation regexes in `src/lib/config/security/validation.ts`. Keeping the validator function in the transport file is fine — but the constants it uses should follow the convention.
- **Never echo the token in errors (security review).** Even partial echoes (first/last N chars) leak entropy. Use `[redacted]` or `[length=N]` markers; test by asserting error messages don't contain the input substring.
- **Code-simplicity reviewer pushed back on the cap entirely.** Their argument: any printable ASCII is fine; HTTP header line limits already cap at 8 KB; we're solving a problem (paste error) the operator notices on the first request. **Decision: keep the cap at 4096 anyway** — it's defence-in-depth at startup-cost-zero, and the failure mode without it is an obscure 431-Header-Too-Large response from Express, not a clear startup error.

---

#### B4 — Auto-sanitize Zod field descriptions on `registerCustomTool()`  *(PR-5)*

> **Revised 2026-05-01 per technical-review pass (S3 + C3 + A7).** The earlier "top-level only" boundary has been replaced with a deep-recurse contract; the rebuild is memoised via `WeakMap` to amortise reload-pattern cost; a Standard-Schema round-trip test locks the regression check.

**What.** Rebuild the top-level `inputSchema` shape at registration time, replacing each field's `description` (sourced from Zod v4's `globalRegistry`) via `field.describe(sanitizeDescription(desc))`. Returns a new `ZodObject` and re-assigns `meta.inputSchema`.

> **CRITICAL — original diff was broken.** An earlier draft of this section mutated `_def.description` in place. In Zod v4 this is a runtime no-op: the description is stored in `z.globalRegistry` (a `WeakMap`), not on `_def`. See `node_modules/zod/v4/classic/schemas.js:74-77`:
>
> ```js
> inst.describe = (description) => {
>     const cl = inst.clone();
>     core.globalRegistry.add(cl, { description });
>     return cl;
> };
> ```
>
> `.describe()` clones the schema and registers the new description in the global registry — it does **not** mutate `_def`. `.parse()`, `.toJSONSchema()`, and the MCP SDK's `.shape` reflection all read from the registry, ignoring `_def.description` entirely. Three independent agents converged on this finding (TypeScript reviewer, security sentinel, Zod-v4 research). The corrected approach below uses `.describe()` and re-assigns the shape.

**Why.** Today `registerCustomTool()` sanitises `meta.title` and `meta.description` only, and explicitly delegates field-description sanitisation to the caller. The contract is documented in `mcp-curl-server.ts:217-220`, but the trust boundary is fragile — documentation is not enforcement. A caller who passes externally-sourced strings into a Zod field's `.describe()` leaks bidi/zero-width chars into the tool advertisement.

**Approach (revised 2026-05-01 per technical-review pass — S3 + C3 + A7).** Rebuild the input schema using Zod v4's public API and **recurse into nested branches**: `field.description` (read from `globalRegistry`) → `field.describe(sanitized)` (clone + re-register) → assemble new `ZodObject` via `z.object(newShape)`. The helper is named `sanitizeFieldDescriptionsDeep` to make the contract obvious at the call site.

**Recursion contract.** The walker descends into:

- `ZodObject` — recurse into each field of `.shape`.
- `ZodArray<ZodObject>` — recurse into the element schema.
- `ZodUnion` — recurse into each option that is itself an object/array-of-object.
- `ZodOptional` / `ZodDefault` / `ZodNullable` — sanitise the wrapper's description (via `.describe()` clone-then-register), then recurse into the wrapped inner schema.

**Memoisation (C3).** Per-call traversal walks every nested object on every `registerCustomTool()` invocation; for a 50-field nested schema with `createApiServer` reload patterns, this multiplies. Memoise via a module-level `WeakMap<z.ZodObject<z.ZodRawShape>, z.ZodObject<z.ZodRawShape>>` keyed on input-schema reference. Skip rebuild if the input is already a known-sanitised output (the rebuild produces a new `ZodObject` reference; cache lookup is identity-based, no false positives). The WeakMap lets GC reclaim entries when schemas go out of scope — no manual eviction.

**Standard-Schema compliance (A7).** `field.description` walks the `_zod.parent` chain in v4; Standard Schema v1 has a different metadata model. Lock the regression check today: a Standard-Schema round-trip test (`z.toJSONSchema(sanitized).description === expected`) ships with B4. If MCP SDK 2.0's Standard Schema migration changes how `.description` resolves, this test fails fast.

**Why a rebuild and not in-place mutation.** Per Zod v4 internals (above): `description` is keyed in `z.globalRegistry` by the schema instance. `.describe()` returns a new instance via `clone()`. The original instance retains its old (or absent) description; the new instance has the sanitized one. To make the registered tool see the sanitized description, we must replace the field reference in the `shape`, then build a new `ZodObject`.

**Diff (`src/lib/extensible/mcp-curl-server.ts:243-294`).**

```diff
+const SANITIZED_SCHEMA_CACHE = new WeakMap<
+    z.ZodObject<z.ZodRawShape>,
+    z.ZodObject<z.ZodRawShape>
+>();
+
+/**
+ * Recursive sanitization of every field description in a Zod schema.
+ * Returns a NEW ZodObject with each field's description (and the
+ * descriptions of nested ZodObject/ZodArray<ZodObject>/ZodUnion-of-object
+ * branches and ZodOptional/ZodDefault/ZodNullable wrappers) sanitized via
+ * sanitizeDescription().
+ *
+ * Memoised per input-schema reference via SANITIZED_SCHEMA_CACHE so repeated
+ * registrations of the same schema (e.g. createApiServer reload patterns)
+ * skip the rebuild.
+ *
+ * Note: Zod v4 stores .description in z.globalRegistry (WeakMap-keyed by
+ * schema instance), not on _def. We use field.describe(sanitized), which clones
+ * the schema and re-registers — mutating _def.description has no runtime effect.
+ */
+function sanitizeFieldDescriptionsDeep(
+    schema: z.ZodObject<z.ZodRawShape>
+): z.ZodObject<z.ZodRawShape> {
+    const cached = SANITIZED_SCHEMA_CACHE.get(schema);
+    if (cached) return cached;
+
+    const oldShape = schema.shape;
+    const newShape: z.ZodRawShape = {};
+    for (const key of Object.keys(oldShape)) {
+        newShape[key] = sanitizeFieldDeep(oldShape[key]);
+    }
+    const result = z.object(newShape);
+    SANITIZED_SCHEMA_CACHE.set(schema, result);
+    return result;
+}
+
+function sanitizeFieldDeep(field: z.ZodTypeAny): z.ZodTypeAny {
+    // 1. Sanitise this field's own description (handles wrappers correctly:
+    //    .describe() clones the wrapper and re-registers).
+    let next = field;
+    const desc = next.description;
+    if (typeof desc === "string" && desc.length > 0) {
+        next = next.describe(sanitizeDescription(desc));
+    }
+    // 2. Recurse into nested branches.
+    if (next instanceof z.ZodObject) {
+        return sanitizeFieldDescriptionsDeep(next);
+    }
+    if (next instanceof z.ZodOptional || next instanceof z.ZodDefault || next instanceof z.ZodNullable) {
+        // Walk inward; the wrapper itself was already re-described above.
+        const inner = sanitizeFieldDeep(next._def.innerType ?? next._def.type);
+        // Re-wrap: implementation detail of Zod v4 — see Research Insights.
+        return rewrap(next, inner);
+    }
+    if (next instanceof z.ZodArray) {
+        const elem = sanitizeFieldDeep(next.element);
+        return z.array(elem).describe(next.description ?? "");
+    }
+    if (next instanceof z.ZodUnion) {
+        const opts = next.options.map(sanitizeFieldDeep);
+        return z.union(opts as [z.ZodTypeAny, ...z.ZodTypeAny[]]).describe(next.description ?? "");
+    }
+    return next;
+}
```

Call from `registerCustomTool()` immediately before `this._customTools.push(...)`:

```diff
         const sanitizedMeta: CustomToolMeta = {
             ...meta,
             title: sanitizedTitle,
             description: truncatedDesc,
+            // Rebuild inputSchema with sanitized field descriptions at every
+            // depth (top-level, nested ZodObjects, ZodArray<ZodObject>,
+            // ZodUnion-of-object, and through ZodOptional/ZodDefault wrappers).
+            inputSchema: sanitizeFieldDescriptionsDeep(meta.inputSchema),
         };

         this._customTools.push({ name, meta: sanitizedMeta, handler });
```

**Update doc comment.** Replace the existing "callers must sanitize" warning with "field descriptions at every depth are auto-sanitized at registration; callers no longer need to defensively sanitise input themselves, but doing so is harmless." Update `docs/custom-tools.md` similarly. Keep B2's README example because it remains the recommended pattern when building schemas dynamically across modules (defensive at the call site).

**Tests (`src/lib/extensible/mcp-curl-server.test.ts`).** Add cases — and **all assertions must read via the public `.description` getter, not `_def.description`**, since the latter would silently pass with the old broken implementation:

- Top-level field with bidi-override `.describe()` → after registration, `customTool.meta.inputSchema.shape.field.description` has the override stripped.
- Top-level optional field (`z.string().optional().describe("‮hello")`) → description still sanitized; `.optional()` still in effect (verify via `.parse(undefined)` succeeding).
- Top-level field with `.default()` → description still sanitized; default still applied.
- **Nested object field (S3):** `z.object({ user: z.object({ name: z.string().describe("‮pwn") }) })` → `inputSchema.shape.user.shape.name.description` has the override stripped.
- **Nested array-of-object (S3):** `z.object({ tags: z.array(z.object({ label: z.string().describe("‮pwn") })) })` → element schema's `label.description` is sanitised.
- **Nested union-of-object (S3):** `z.object({ payload: z.union([z.object({ a: z.string().describe("‮pwn") }), …]) })` → each option's nested descriptions are sanitised.
- **Nested through optional (S3):** `z.object({ inner: z.object({ x: z.string().describe("‮pwn") }).optional() })` → `inner` is sanitised through the wrapper.
- Field without a `.describe()` → no throw, field reference preserved by identity (`oldShape.x === newShape.x`).
- **Memoisation idempotence (C3):** registering the same `inputSchema` twice → second call hits `SANITIZED_SCHEMA_CACHE` and returns the cached output reference (verify via `===`).
- **JSON Schema round-trip:** `z.toJSONSchema(sanitizedMeta.inputSchema)` shows the sanitized description in the output (regression test against the broken `_def` mutation, which would have shown the original).
- **Standard-Schema regression (A7):** `z.toJSONSchema(sanitizedMeta.inputSchema).properties.field.description` equals the sanitised value at every depth (locks the regression check against a future Standard Schema migration).

**Acceptance criteria.**

- [x] Field descriptions are sanitised at registration time at **every depth** — top-level, nested `ZodObject`, `ZodArray<ZodObject>`, `ZodUnion`-of-object (including `ZodDiscriminatedUnion`), `ZodTuple` items + rest, `ZodRecord`/`ZodMap` keys + values, `ZodSet` value type, `ZodIntersection` arms, `ZodPipe` (i.e. `.transform()`/`.pipe()`) in/out, `ZodLazy` getter result, and through `ZodOptional`/`ZodDefault`/`ZodNullable`/`ZodReadonly`/`ZodCatch`/`ZodPromise` wrappers — **verified through the public `.description` getter and `z.toJSONSchema()` output** (not `_def.description`).
- [x] Helper is named `sanitizeFieldDescriptionsDeep` (not `sanitizeTopLevelFieldDescriptions`); doc-comment + `docs/custom-tools.md` reflect the deep contract.
- [x] Repeated registration of the same schema reference is idempotent and returns the original schema instance (no clone, no rebuild) — verified via reference equality. The shipped `sanitizeFieldDescriptionsDeep` mutates `z.globalRegistry` entries in place; the change-on-equal short-circuit makes a second walk a no-op without any cache.
- [x] `z.toJSONSchema()` round-trip preserves sanitised descriptions at every depth (Standard-Schema regression check).
- [x] Existing `mcp-curl-server.test.ts` cases still pass.
- [x] B2's README example wording softens from "required" to "defensive — also runs at registration at every depth."

**Research Insights (added 2026-05-01).**

- **The original diff was a runtime no-op (TypeScript + security + Zod research convergence).** Mutating `_def.description` in Zod v4 has no observable effect — the registry is the source of truth. This finding came from three independent agents and was verified against `node_modules/zod/v4/classic/schemas.js:74-77`.
- **`.describe()` is the supported way to set/replace a description.** It is implemented as clone-then-register, which is exactly what we need: the original schema instance is untouched (no shared-state hazard if the caller reuses the schema elsewhere), and the new instance carries the sanitized description.
- **The `unwrap()` traversal in the original diff is unnecessary.** `.describe()` on a `.optional()` or `.default()` wrapper is the correct call site — it clones the wrapper and registers the description on the clone. Walking inward to mutate the inner schema's `_def` was both incorrect (no-op) and conceptually wrong (the wrapper is the "field," not the inner type).
- **Zod v5 risk (deferred).** Zod v5 has not shipped. If it does during this work cycle, recheck `field.description` and `field.describe()` are still public API. The pinned range `^4.0.0` in `package.json` should keep us on v4 for now.
- **Standard Schema readiness (informational).** `CustomToolMeta.inputSchema: z.ZodObject<z.ZodRawShape>` is currently typed Zod-specific. For MCP SDK 2.0's Standard Schema migration, this typing would need to widen. **B4 doesn't block that** — the rebuild logic only needs `field.description` and `field.describe()`, both of which are Zod-native and still required for the sanitization step. Migration to Standard Schema would replace this whole helper, not extend it.

---

#### B3 — Defence-in-depth parity for YAML/custom-tool output  *(PR-6b)*

> **Revised 2026-05-01 per technical-review pass (A1, A2, A3, A4, A5, A6, S2, S4, A11 + blind-spot).** Wrap lives in a new `src/lib/response/post-processor.ts` module; uses a factory pattern `createWrapper(config) → (result, hostname) => CallToolResult` (binding server-scope config once, passing request-scope hostname per call); enforces idempotence via a `Symbol.for("mcp-curl.wrapped")` tag; routes the hook-executor short-circuit path through wrap; delegates to the existing `sanitizeAndDetect()` in `detection-logger.ts` rather than reinventing the sanitise+detect+log composition; detects on the **original** text before sanitisation neutralises the signal; pins the spotlight UUID per-message; wraps the wrap in a try/catch so a defence-in-depth path can never propagate exceptions to the handler boundary.

**What.** Replace `maybeApplySpotlighting()` with a broader wrap that runs **all three** response-side defences (detect-on-original → sanitise → spotlight) on text output from YAML-driven tools, custom tools, and hook short-circuit returns. The wrap lives in a new module `src/lib/response/post-processor.ts` and is used by `tool-wrapper.ts`, `generator.ts:createToolHandler()`, and the `hook-executor` short-circuit path.

**Why (original asymmetries).** `maybeApplySpotlighting()` runs only inside `tool-wrapper.ts`, which wraps `curl_execute` and `jq_query`. Tools registered via `generateToolDefinitions()` / `registerEndpointTools()` in `src/lib/schema/generator.ts:497-507` register handlers directly with `server.registerTool()` and **bypass the wrapper**. Result: a YAML-configured server with `enableSpotlighting: true` silently does NOT spotlight YAML-driven endpoints. Even *inside* `tool-wrapper.ts`, only spotlighting ran — `sanitizeResponse()` and `detectInjectionPattern()` never executed on the path between a custom-tool / YAML-tool's `executeCurlRequest()` return value and the LLM. Custom-tool and YAML-tool handlers that synthesise their own `content[].text` strings (constructed from cached data, transformed via post-handlers, or returned by a hook short-circuit) leak unsanitised, undetected text to the LLM.

**Why (S2 — hook short-circuit bypass).** Audit of `src/lib/extensible/hook-executor.ts:55-88` revealed a fourth bypass class: when `beforeRequest` returns a `CallToolResult`, the executor skips the cURL call **and** skips wrap (because wrap fires after the cURL parse). User-supplied hook results reach the LLM unsanitised. The post-processor module addresses this by being callable from `hook-executor` directly, not just from the post-cURL path.

**Layer placement (A2 + A5).** The wrap fires inside the **handler-registration adapter** (`registerCustomTool`/YAML `createToolHandler`/hook-executor short-circuit), not at the transport boundary. Prompts and resources have separate wrap entry points (B7-sub-4, B7-sub-5). Layer diagram:

```
┌─────────────────────────────────────────────────────────────────────┐
│                       MCP server (transport)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │   handler-registration       │
              │   adapter (per tool)         │
              │                              │
              │   ┌── tool-wrapper.ts ────┐  │
              │   │  curl_execute / jq    │  │
              │   │  → executeCurlRequest │──┼─→ wrap(result, hostname)
              │   └───────────────────────┘  │
              │                              │
              │   ┌── generator.ts ───────┐  │
              │   │  YAML tool handler    │──┼─→ wrap(result, hostname)
              │   └───────────────────────┘  │
              │                              │
              │   ┌── registerCustomTool ─┐  │
              │   │  user handler         │──┼─→ wrap(result, "custom")
              │   └───────────────────────┘  │
              │                              │
              │   ┌── hook-executor ──────┐  │
              │   │  beforeRequest        │──┼─→ wrap(short-circuit, host)
              │   │  short-circuit return │  │
              │   └───────────────────────┘  │
              └──────────────┬───────────────┘
                             │
                ┌────────────┴────────────┐
                │  prompts & resources    │
                │  (B7-sub-4, B7-sub-5)   │  ← separate wrap entry points
                └─────────────────────────┘
```

Transport-layer wrap is explicitly out of scope.

**Approach.** New module `src/lib/response/post-processor.ts` exporting a factory:

1. `createWrapper(config: { enableSpotlighting?: boolean })` returns a closure `(result: CallToolResult, hostname: string) => CallToolResult`. Server-scope config (the spotlighting flag) is bound once at server creation; request-scope hostname is passed per call (A4 — matches the `createApiServer` factory pattern).
2. For each `content[i].type === "text"` part:
   a. **Detect on the original text first (S4)** — call `detectInjectionPattern(originalText)` and emit the throttled stderr log. If we detected after sanitisation, the sanitiser may have already stripped the malicious pattern, silencing the log.
   b. Apply `sanitizeResponse(originalText)` for output.
   c. If `config.enableSpotlighting && !result.isError`: wrap the sanitised text via `applySpotlighting(text, perMessageUuid)` where `perMessageUuid = randomUUID()` is generated **once per `wrap()` call** (A11 — per-message scope; sentinels need per-prompt isolation).
3. Internally, delegate to the existing `sanitizeAndDetect(text, hostname)` helper in `src/lib/security/detection-logger.ts` rather than reinventing the sanitise+detect+log composition (A3). Update `sanitizeAndDetect()` itself to detect-on-original-then-sanitise per S4 — the change is local to that function and benefits all callers.
4. **Idempotence (A1 — double-wrap on `createApiServer`).** `createApiServer()` builds tools via `registerCustomTool`, which already passes them through wrap. If the consumer later registers the same handler explicitly, double-wrap is possible. Tag the returned `CallToolResult` with `Symbol.for("mcp-curl.wrapped")` (a non-enumerable property keyed on the symbol). The wrap reads the tag and short-circuits if already set.
5. **Hook short-circuit (S2 + A6).** Export a second factory entry point `wrapHookResult(result, hostname, config)` (or have the same closure accept any result). Update `hook-executor.ts` to route `beforeRequest`'s `CallToolResult` returns through the wrap before returning.
6. **Try/catch (blind-spot).** The whole wrap body is enclosed in a try/catch. On error, return the original `result` unchanged and emit a throttled `[wrap-error] [hostname] ErrorClassName` log to stderr (same throttle as injection-detection). Defence-in-depth must never become a load-bearing dependency.
7. Fail-closed for malformed result shapes (matches existing `maybeApplySpotlighting()` semantics).
8. **Skip when `result.isError === true`** — error text is internally generated, doesn't carry external content, and re-running detection on it would produce noise. Idempotence tag still applied so a downstream wrap call short-circuits.

**Diff sketch (`src/lib/response/post-processor.ts` — new module).**

```typescript
import { randomUUID } from "crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { applySpotlighting } from "../utils/index.js";
import { sanitizeAndDetect } from "../security/detection-logger.js";
import { logWrapError } from "../security/wrap-error-logger.js";

const WRAPPED = Symbol.for("mcp-curl.wrapped");

interface WrapperConfig {
    enableSpotlighting?: boolean;
}

export function createWrapper(config: WrapperConfig) {
    return function wrap(result: CallToolResult, hostname: string): CallToolResult {
        // Idempotence: skip if a previous wrap has already run.
        if ((result as { [WRAPPED]?: true })[WRAPPED]) return result;

        try {
            // Errors pass through unchanged (still tagged so a later wrap is a no-op).
            if (result.isError) return tag(result);

            const newContent = result.content.map(part => {
                if (part.type !== "text" || typeof part.text !== "string") return part;
                // sanitizeAndDetect now does: detect(original) → log → return sanitise(original).
                const sanitized = sanitizeAndDetect(part.text, hostname);
                const finalText = config.enableSpotlighting
                    ? applySpotlighting(sanitized, randomUUID())
                    : sanitized;
                return { ...part, text: finalText };
            });
            return tag({ ...result, content: newContent });
        } catch (err) {
            logWrapError(hostname, err);
            return tag(result); // Defence-in-depth — never propagate.
        }
    };
}

function tag(result: CallToolResult): CallToolResult {
    Object.defineProperty(result, WRAPPED, { value: true, enumerable: false });
    return result;
}
```

**Diff sketch (`src/lib/security/detection-logger.ts` — update `sanitizeAndDetect`).** Change the existing helper to detect on the original input *before* sanitising, so detection log signal is preserved when the sanitiser would have stripped the pattern:

```diff
 export function sanitizeAndDetect(text: string, hostname: string): string {
-    const sanitized = sanitizeResponse(text);
-    if (detectInjectionPattern(sanitized)) logInjectionDetected(hostname);
-    return sanitized;
+    // Detect on the original — sanitiser may strip the signal otherwise.
+    if (detectInjectionPattern(text)) logInjectionDetected(hostname);
+    return sanitizeResponse(text);
 }
```

**Diff sketch (`src/lib/extensible/tool-wrapper.ts`).** `maybeApplySpotlighting()` callsite is replaced by the factory:

```diff
+const wrap = createWrapper({ enableSpotlighting: config.enableSpotlighting });
…
-            return maybeApplySpotlighting(result, hostname, config);
+            return wrap(result, hostname);
```

For `jq_query` and custom tools the hostname is `"n/a"` (the throttle keys on it but logs `[n/a]`, matching existing convention for source-less injection signal).

**Diff sketch (`src/lib/schema/generator.ts:createToolHandler`).** After `executeCurlRequest()` returns:

```diff
+            const wrap = createWrapper({ enableSpotlighting: config.enableSpotlighting });
…
-            return await executeCurlRequest({...}, execExtra);
+            const result = await executeCurlRequest({...}, execExtra);
+            return wrap(result, hostname);
```

This requires plumbing `config.enableSpotlighting` through `GeneratorConfig`. Add `enableSpotlighting?: boolean` to `GeneratorConfig`, propagate from `createApiServer()` / `McpCurlServer`'s YAML registration path.

**Diff sketch (`src/lib/extensible/hook-executor.ts` — S2 short-circuit fix).**

```diff
+const wrap = createWrapper({ enableSpotlighting: config.enableSpotlighting });
…
 if (hookResult && "content" in hookResult) {
-    return hookResult;                       // Bypass — unsanitised, undetected.
+    return wrap(hookResult, hostname ?? "n/a");
 }
```

**Naming note (pattern review).** With the expanded scope, the closure returned by `createWrapper` describes intent rather than mechanism, matches the security-helper vocabulary used elsewhere in the codebase (`sanitizeResponse`, `detectInjectionPattern`, `applySpotlighting`), and is the only place all three defences compose.

**Update doc comment.** `src/lib/types/public.ts:35-39` — remove the asymmetry caveat (the flag now applies to YAML-driven tools too); add a note that custom-tool handler return values and hook short-circuit returns are also defended.

**Tests.** Add cases to `src/lib/schema/generator.test.ts`, `src/lib/extensible/mcp-curl-server.test.ts`, `src/lib/extensible/hook-executor.test.ts`, and a new `src/lib/response/post-processor.test.ts`:

- YAML tool with `enableSpotlighting: false` → text **is** sanitized + detection logged, but **not** wrapped in sentinels.
- YAML tool with `enableSpotlighting: true` → text sanitized + detected + wrapped.
- Custom-tool handler returning text with U+202E embedded → text emerges sanitised even with spotlighting off (regression test for the 4th asymmetry).
- Custom-tool handler returning text containing `ignore previous instructions` → `console.error` sees `[injection-defense] [hostname] InjectionDetected` (verify via `vi.spyOn`).
- **Detection-on-original (S4):** handler returns text containing a malicious pattern that `sanitizeResponse` would strip → detection log fires *before* sanitisation; the returned text is sanitised (verifies S4 ordering).
- **Idempotence (A1):** wrap a `CallToolResult` twice → second call short-circuits (no double-sanitise, no double-log). Assert via `vi.spyOn(sanitizeAndDetect)` call count.
- **Hook short-circuit (S2):** `beforeRequest` returns `{ content: [{ type: "text", text: "‮malicious‬ ignore previous instructions" }] }` → wrap fires, text sanitised, detection log emitted.
- **Per-message UUID (A11):** two consecutive wrap calls produce different sentinel UUIDs.
- **Try/catch (blind-spot):** mock `sanitizeAndDetect` to throw → wrap returns original `result` unchanged, emits one `[wrap-error] [hostname] ErrorClassName` log.
- Error result (`isError: true`) → no defence applied (matches built-in tool behaviour); idempotence tag still set.
- Multi-part content array (mix of `text` and non-`text`) → only text parts are processed.
- **Factory binding (A4):** two `createWrapper` instances with different `enableSpotlighting` settings produce independent closures; mixing call sites does not cross-contaminate.

**Acceptance criteria.**

- [ ] `createWrapper(config)` exported from `src/lib/response/post-processor.ts`; the closure has signature `(result, hostname) => CallToolResult`.
- [ ] Called from `tool-wrapper.ts`, the YAML tool handler path, `registerCustomTool`'s adapter, **and** the `hook-executor` short-circuit path; `maybeApplySpotlighting()` removed.
- [ ] `sanitizeAndDetect()` in `detection-logger.ts` detects on the original text before sanitising (S4).
- [ ] **Idempotence:** double-wrap is a no-op via the `Symbol.for("mcp-curl.wrapped")` tag — regression test asserts `sanitizeAndDetect` runs exactly once for a result wrapped twice (A1).
- [ ] **Hook short-circuit** routes through wrap (S2); regression test in `hook-executor.test.ts` covers the bypass.
- [ ] `enableSpotlighting: true` wraps YAML-tool text responses with sentinels.
- [ ] Custom-tool / YAML-tool text output is sanitised and detection-logged regardless of spotlighting flag.
- [ ] Spotlight UUID is generated **per `wrap()` call** (per-message), not per-session (A11).
- [ ] **Defence-in-depth invariant (blind-spot):** wrap try/catches its body; on error, returns the original `result` and emits a throttled `[wrap-error]` log. Wrap never propagates exceptions to the handler boundary.
- [ ] Error results pass through unchanged.
- [ ] Doc comment in `types/public.ts` no longer warns about partial coverage.
- [ ] `applySpotlighting()` reused; no duplicate sentinel logic.

**Research Insights (added 2026-05-01).**

- **Fourth asymmetry surfaced (architecture HIGH).** The three asymmetries listed in the original Problem Statement (sanitise-on-read vs at-load, missing spotlight on YAML, missing top-level field-description sanitise) were not exhaustive. Custom-tool / YAML-tool **output** also bypasses sanitisation/detection. Without B3's expanded scope, a YAML or custom-tool consumer's response — even one returning content the handler synthesised from a cached or hook-short-circuited path — reaches the LLM unsanitised.
- **PR-6 is now PR-6a (B9) + PR-6b (B3).** Combining sanitise-when (B9) with defence-where (B3) put two unrelated mental models in one diff. Reviewers handle each in isolation now.
- **Throttle reuse.** The per-hostname injection-detection log throttle from PR-#20 is shared — `wrapWithDefence` should use the same throttle key, not introduce a parallel one. (Otherwise a YAML-tool burst + a curl_execute burst on the same host would double-log within the throttle window.)

---

#### B9 — Sanitize YAML schema descriptions at validate time  *(PR-6a)*

> **Revised 2026-05-01 per technical-review pass (S1 + A8).** Sanitisation moves onto `ApiSchemaValidator` itself via a `.transform()` step (closes the raw-Zod-schema bypass); raw YAML strings are pre-sanitised *before* Zod parsing in `loadApiSchema()` so attacker-controlled content cannot survive in Zod error messages. Sanitisation is an **invariant of parsing**, not of post-validation.

**What.** Sanitise once **on the `ApiSchemaValidator` Zod schema itself** (via `.transform()`) and store the sanitised strings on the schema object. Eliminate the repeated `sanitizeDescription()` calls in `src/lib/schema/generator.ts` (currently approximately at lines 60, 74, 315, 322, 462, 469, 471, 473, 500, 530).

**Why an invariant of parsing, not post-validation (security review HIGH — S1).** `validateApiSchema()` is one entry point, but `ApiSchemaValidator` (the raw Zod schema) is itself re-exported via `src/lib/schema/index.ts:21` and `src/lib.ts:39`. A consumer can:

```typescript
import { ApiSchemaValidator, generateToolDefinitions } from "mcp-curl";
const schema = ApiSchemaValidator.parse(JSON.parse(payload));
generateToolDefinitions(schema, config);
```

If sanitisation lives only inside `validateApiSchema()`, the `ApiSchemaValidator.parse()` path bypasses it entirely. **Attaching `.transform(sanitizeApiSchemaInPlace)` to `ApiSchemaValidator` itself** closes this: every entry point that produces a parsed `ApiSchema` (loader, in-memory, programmatic, raw schema parse) routes through the same Zod pipeline, so every entry point is pre-sanitised.

**Why pre-Zod raw-YAML sanitise (A8 belt-and-braces).** Even with `.transform()` on the validator, malformed YAML produces Zod error messages that can echo attacker-controlled description content *before* the transform runs. Pre-sanitise raw YAML strings inside `loadApiSchema()` / `loadApiSchemaFromString()` by walking the parsed-YAML object and `sanitizeDescription()`'ing every string under known description keys before passing to `ApiSchemaValidator.parse()`. The transform still runs (defence in depth); on success, both layers have sanitised; on failure, the error message no longer carries attacker content.

**Approach.**

1. In `src/lib/schema/validator.ts`, attach a `.transform()` step to `ApiSchemaValidator` (the exported Zod schema) that runs `sanitizeApiSchemaInPlace()` on the parsed object before returning. Apply `sanitizeDescription()` to every string field that downstream code currently sanitises:
   - `api.title`, `api.description` (if any code path reads these for tool ads)
   - Each `endpoint.title`, `endpoint.description`
   - Each `endpoint.parameters[*].description`
   - Each `endpoint.response.filterPresets[*].name` and `filterPresets[*].description`
2. In `src/lib/schema/loader.ts`, after `js-yaml`'s parse and before `ApiSchemaValidator.parse()`, walk the raw object and pre-sanitise the same set of description keys (A8). The function is internal — `sanitizeRawYamlDescriptions(obj)` lives next to the loader.
3. **Drop the type-brand idea.** TypeScript reviewer + simplicity reviewer + plan-critic converged: a `__sanitized: true` brand adds friction at every call site without preventing the bypass — the brand is satisfied by simply asserting the type. The Zod `.transform()` is the actual safety property; the type-brand is theatre. Document the invariant in `ApiSchemaValidator`'s JSDoc and in `validateApiSchema()`'s JSDoc instead.
4. In `src/lib/schema/generator.ts`, remove the now-redundant `sanitizeDescription()` calls. Add a top-of-file comment: "Schemas reaching this module are pre-sanitised by `ApiSchemaValidator`'s `.transform()` step. Do not re-sanitise."

**Note on filterPresets duplicate-name detection.** `generator.ts:74-80` currently detects duplicate preset names *after* sanitisation. Move that check into the same `.transform()` step so it runs inside `ApiSchemaValidator` — duplicates should be a validation error, not a tool-generation error.

**Tests.**

- Round-trip via `loadApiSchema()`: load a YAML containing `​` in `endpoint.description` → assert the loaded schema's `endpoint.description` has the zero-width space stripped.
- **Raw-validator-bypass coverage (S1):** call `ApiSchemaValidator.parse(rawObject)` directly with `​` in `endpoint.description` → assert it's stripped (regression test for the bypass that motivated moving sanitisation onto the schema).
- **`validateApiSchema(rawObject)` path:** same payload → same sanitised output (the wrapper is now a thin call-through to `ApiSchemaValidator.parse()`).
- **Pre-Zod sanitise (A8):** load a YAML containing a malformed structure with attacker-controlled bidi chars in a description → assert the Zod error message does **not** contain the raw bidi chars (they were sanitised before Zod ran).
- **YAML pipeline integration test (#020 — covers the full schema → tool-registration path):**
  - `loadApiSchemaFromString(yamlWithDataUrlBaseUrl)` → throws with a `scheme`-class message (no parsed schema escapes).
  - `validateApiSchema({ ...rawObj, api: { baseUrl: "data:text/plain,evil" } })` → throws with the same error class.
  - `ApiSchemaValidator.parse(...)` → same.
- Generator no longer re-sanitises: pass a manually-constructed (already-validated-shape) object with `​` in `endpoint.description` *directly* into `generateInputSchema()` (skipping `ApiSchemaValidator`) — assert the description is preserved verbatim. This documents the boundary in code: validator sanitises; generator trusts.
- Duplicate filter-preset names trigger an `ApiSchemaValidationError` at parse time (inside the `.transform()` step), not tool-generation time.

**Acceptance criteria.**

- [x] `ApiSchemaValidator` has a `.transform()` step that runs `sanitizeApiSchemaInPlace()` on the parsed object.
- [x] All public entry points that produce a parsed `ApiSchema` (`loadApiSchema`, `loadApiSchemaFromString`, `validateApiSchema`, **and the re-exported `ApiSchemaValidator.parse()` path**) yield pre-sanitised schemas.
- [x] `loadApiSchema` / `loadApiSchemaFromString` pre-sanitise raw YAML strings before invoking `ApiSchemaValidator.parse()` — Zod error messages on malformed YAML cannot echo attacker-controlled description content.
- [x] **YAML pipeline integration test (#020):** a YAML schema with `baseUrl: data:...` is rejected through `loadApiSchemaFromString`, `validateApiSchema(rawObj)`, and `ApiSchemaValidator.parse(rawObj)` (defence-in-depth gate against the URL invariant being silently broken when the `.transform()` mutates the schema).
- [x] `generator.ts` has no remaining redundant `sanitizeDescription()` calls. *(One non-redundant call survives on `preset.jqFilter` — the validator deliberately leaves jqFilter raw so the engine receives the author's filter unchanged; sanitisation at the display-time interpolation site is documented in the top-of-file comment block.)*
- [x] A top-of-file comment in `generator.ts` documents the contract.
- [x] Duplicate filter-preset detection moved into the `.transform()` step (combined with sanitisation in a single `transform((s, ctx) => …)` so the duplicate check sees post-sanitise names).
- [x] Existing `schema.test.ts` (loader/validator/generator merged) plus 14 new PR-6a tests all pass — full suite 676/676.

**Research Insights (added 2026-05-01).**

- **Public-API bypass found (security HIGH).** `validateApiSchema` is exported (`src/lib.ts` re-exports the schema utilities). Sanitisation in the loader alone leaves the validator-only path silently unsanitised. Moving sanitisation to `validateApiSchema()` is the correct trust-boundary anchor.
- **Type brand dropped (TypeScript + simplicity + plan-critic convergence).** A `SanitizedApiSchema` brand requires every consumer to know about it; a runtime invariant inside the validator is opaque-but-safe. The brand offered no defence the runtime check doesn't, and made the codebase more typing-aware without adding security.
- **Generator-trust documented in code, not just comments.** Add a comment block at the top of `generator.ts` *and* a single-line `// pre-sanitised by validateApiSchema()` comment at the function body where each removed `sanitizeDescription()` call used to be. The latter is the comment a future contributor sees when they grep `sanitizeDescription` and wonder why it's not here.
- **`api.title`/`api.description` paths.** Audit found these are not currently consumed in tool advertisement; only `endpoint.*` strings are. Sanitise them anyway (defence in depth, near-zero cost) since the validator runs once at startup.

---

#### B7 (sub-1-3) — Impactful sanitisation gaps in `RESPONSE_SANITIZE_PATTERN`  *(PR-7)*

**What.**

1. **Widen `RESPONSE_SANITIZE_PATTERN`** to collapse:
   - 50+ consecutive ASCII spaces (existing)
   - 50+ consecutive tabs (`\t`)
   - 50+ consecutive non-breaking spaces (U+00A0)
   - 50+ consecutive other whitespace (U+2000–U+200A — em/en spaces, U+202F NARROW NO-BREAK SPACE, U+205F MEDIUM MATHEMATICAL SPACE, U+3000 IDEOGRAPHIC SPACE)
   - 20+ consecutive newlines (`\n`)
2. **Add missing Unicode ranges** to `UNICODE_ATTACK_RANGES`. The current list misses several documented 2025–2026 attack vectors:
   - **U+180B–U+180D MONGOLIAN FREE VARIATION SELECTORs ONE-TO-THREE** (used in 2025 "Sneaky Bits" research alongside U+FE00–U+FE0F).
   - **U+180E MONGOLIAN VOWEL SEPARATOR** (existing in plan, retained).
   - **U+115F / U+1160 HANGUL CHOSEONG/JUNGSEONG FILLERs**.
   - **U+3164 HANGUL FILLER**.
   - **U+2062 INVISIBLE TIMES**, **U+2064 INVISIBLE PLUS** — already in the existing range U+2060–U+2064 for invisible operators, but explicitly call out in tests so future regressions can't drop them silently.
   - **U+2800 BRAILLE PATTERN BLANK** (renders as space in Braille fonts; documented hiding character in 2026 prompt-injection research).
   - **U+061C ARABIC LETTER MARK** (bidi control; used to flip rendering order similar to U+202E but commonly missed in detector lists).
   - **U+FE00–U+FE0F VARIATION SELECTORs ONE-TO-SIXTEEN** — already in range, confirm regression test.
   - **U+E0100–U+E01EF VARIATION SELECTORs SEVENTEEN-TO-256** — already in range U+E0000–U+E007F per the current pattern? **Audit required**: U+E0000–U+E007F covers the *Tag* block; the variation-selector supplement is U+E0100–U+E01EF, which is **not** in the current range. Add it.
3. **Document the 50-space threshold rationale** in the comment block. (49 spaces is functionally equivalent to 50 spaces for hiding content; the threshold is a heuristic.) **Don't lower** the threshold — false-positive risk on legitimate formatting is non-trivial. Document the off-by-one tolerance instead.

**Why.**

- **Tabs slip through today.** 50 tabs → 52-char output, no collapse — verified empirically.
- **NBSP and other Unicode whitespace** can produce visually equivalent padding the LLM sees as "trailing space" but the regex doesn't catch.
- **20+ newlines** is enough to push trailing content out of a typical context window's visible scroll — defence in depth.
- **Missing Unicode invisibles** are font-renderer-dependent but render as zero-width in many MCP client UIs; same attack class as the existing `UNICODE_ATTACK_RANGES`.

**Diff sketch (`src/lib/utils/sanitize.ts`).**

```diff
 const UNICODE_ATTACK_RANGES =
-    "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}";
+    "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u115F\\u1160\\u180B-\\u180E\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\u2800\\u3164\\uFEFF\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}";

-const RESPONSE_SANITIZE_PATTERN = new RegExp(`[${UNICODE_ATTACK_RANGES}]+| {50,}`, "gu");
+// Whitespace-padding attacks: collapse runs of any visual-space character to one
+// space, and runs of newlines to one newline. Thresholds are heuristic — 50
+// chars (or 20 newlines) is the smallest run unlikely in legitimate formatting.
+// 49-char runs are functionally equivalent for hiding content; this is an
+// accepted tolerance, not a bug.
+const WHITESPACE_PADDING_PATTERN = "[\\u0020\\t\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]{50,}|\\n{20,}";
+const RESPONSE_SANITIZE_PATTERN = new RegExp(
+    `[${UNICODE_ATTACK_RANGES}]+|${WHITESPACE_PADDING_PATTERN}`,
+    "gu"
+);
```

**Update `sanitizeResponse()`.** The match-callback today returns `" "` for space matches and `""` for Unicode matches. Update logic so newline-runs collapse to `"\n"` (preserves JSON validity for multi-line JSON; preserves rough document structure) and any whitespace-padding match returns `" "`.

**Tests (`src/lib/utils/sanitize.test.ts`).** Each new behaviour gets a bypass-demonstration test:

- 50 tabs → collapsed to single space.
- 50 NBSPs → collapsed to single space.
- 50 em-spaces (U+2003) → collapsed to single space.
- 50 IDEOGRAPHIC SPACE (U+3000) → collapsed to single space.
- 19 newlines → preserved (below threshold).
- 20 newlines → collapsed to single `\n`.
- Mixed run of 30 spaces + 30 tabs → matches as 60-char run, collapsed.
- U+180B (Mongolian VS-1) → removed.
- U+180E → removed.
- U+2062 (INVISIBLE TIMES) → removed.
- U+2800 (BRAILLE PATTERN BLANK) → removed.
- U+3164 → removed.
- U+061C (ARABIC LETTER MARK) → removed.
- U+E0101 (Variation Selector-18) → removed.

**Acceptance criteria.**

- [ ] `sanitizeResponse()` collapses tab/NBSP/Unicode-space runs at the same threshold as ASCII space.
- [ ] Newline runs ≥ 20 collapse to a single newline.
- [ ] **Eight additional Unicode invisibles** in `UNICODE_ATTACK_RANGES` (U+061C, U+115F, U+1160, U+180B–U+180E, U+2800, U+3164, U+E0100–U+E01EF range).
- [ ] 50-space threshold rationale documented with an explicit "49 is accepted tolerance" comment.
- [ ] Each new pattern has a regression test demonstrating the previous bypass.

**Research Insights (added 2026-05-01).**

- **2025–2026 prompt injection SOTA names two attack classes the original plan misses (security + injection-research).**
  - **"Sneaky Bits"** — payloads encoded in U+E0100–U+E01EF Variation Selectors. The encoder hides arbitrary bytes inside variation-selector codepoints attached to a host character; visually invisible but reachable by `String.codePointAt()`. Without the U+E0100–U+E01EF range, our sanitiser drops the host character but keeps the smuggled VS bytes — partial defence is worse than none, since the LLM may decode them.
  - **U+2800 BRAILLE PATTERN BLANK** — documented in 2026 reports as a "looks-like-space" character that is functionally `U+2800 BRAILLE PATTERN BLANK` (a single code point, not whitespace). Some tokenizers split on it; some don't. Strip it to avoid the inconsistency.
- **U+061C ARABIC LETTER MARK is a bidi control** with the same hiding properties as U+202E but commonly missed by sanitiser lists. Added to the range.
- **The U+E0000–U+E007F → U+E0100–U+E01EF audit was non-trivial.** The current plan's `\\u{E0000}-\\u{E007F}` covers only the **Tag** block; the **Variation Selectors Supplement** is U+E0100–U+E01EF, a separate sub-range. They are *both* in the Unicode "Tags and Variation Selectors Supplement" *block group*, but the existing regex covers only the lower half. Test fixtures must explicitly exercise both.
- **NFKC won't help the strip layer.** NFKC is for the *detection* path (B7-sub-4-5). It's irrelevant here because the sanitiser already removes the codepoints by their numeric range; canonical-equivalent forms aren't a concern when the rule is "remove all of these."

---

#### B8 — Strip HTML `<script>`/`<style>` blocks + markdown image beacons  *(PR-7)*

**What.** In `src/lib/response/processor.ts`, after the existing HTML-comment stripping step (line 60-62), add:

1. **Strip `<script>…</script>` and `<style>…</style>` blocks** (tag + content) from `text/html` and other markup-comment-supporting content types, *before* Unicode sanitisation. Hardened against ReDoS (length cap, fixed-point iteration, entity decode, negative lookahead).
2. **Strip markdown image beacons AND external links** with external URLs (`![alt](https://tracker.example.com/pixel)` and `[label](https://tracker.example.com/click?token=…)`) when content type indicates markdown.

**Why.**

- Both can carry injection payloads that survive HTML-comment removal.
- `<script>` blocks may contain prompt-injection text that the LLM cannot distinguish from legitimate guidance.
- `<style>` blocks can hide content via CSS (`content: "ignore previous instructions"`).
- Markdown image beacons enable exfiltration via image-load (the LLM client may fetch the image, leaking content metadata).
- **Markdown links** are the same exfil class as images — many MCP clients render markdown links as clickable surfaces, and click-tracking URLs leak metadata identical to image-pixel beacons.

**Diff sketch (`src/lib/response/processor.ts`).**

```diff
+// 256 KB body cap for the strip path. Bodies above this skip block-stripping
+// entirely (Unicode sanitisation still runs). Caps O(n²) worst case on
+// pathological inputs.
+const STRIP_PATH_MAX_BYTES = 256 * 1024;
+
+// Fixed-point iteration cap. Self-healing payloads like
+// "<scr<script>ipt>alert(1)</scr</script>ipt>" require ≥2 passes to fully
+// neutralize; cap at 4 to guarantee termination in pathological cases.
+const STRIP_FIXED_POINT_MAX_ITERATIONS = 4;
+
+// Negative lookahead body — refuses to match if a nested <script appears
+// before the closing tag, defeating the simplest self-healing bypass.
+// Anchored on \b to avoid <scriptlike> matches.
+const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>(?:(?!<\/?script\b)[\s\S])*?<\/script>/gi;
+const STYLE_BLOCK_PATTERN  = /<style\b[^>]*>(?:(?!<\/?style\b)[\s\S])*?<\/style>/gi;
+
+// External-domain markdown image: ![alt](http(s)://...). Same-origin / relative
+// paths are preserved. Closing-paren-aware to avoid catastrophic backtracking
+// on adversarial payloads.
+const MARKDOWN_EXTERNAL_IMAGE_PATTERN = /!\[[^\]\n]{0,256}\]\(https?:\/\/[^\s)]{1,2048}\)/g;
+const MARKDOWN_EXTERNAL_LINK_PATTERN  = /(?<!!)\[[^\]\n]{0,256}\]\(https?:\/\/[^\s)]{1,2048}\)/g;
+
+function decodeNumericHtmlEntities(s: string): string {
+    // Decode &#x73;cript / &#115;cript so entity-encoded payloads can't slip
+    // past the strip patterns. Decoded once per pass.
+    return s
+        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
+        .replace(/&#(\d+);?/g,         (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
+}
+
+function stripBlocksFixedPoint(input: string): string {
+    if (input.length > STRIP_PATH_MAX_BYTES) return input;  // skip; sanitiser still runs after
+    let prev = input;
+    let curr = decodeNumericHtmlEntities(prev);
+    for (let i = 0; i < STRIP_FIXED_POINT_MAX_ITERATIONS && curr !== prev; i++) {
+        prev = curr;
+        curr = curr.replace(SCRIPT_BLOCK_PATTERN, "").replace(STYLE_BLOCK_PATTERN, "");
+    }
+    return curr;
+}

     if (isText) {
         if (supportsMarkupComments(options.contentType)) {
             content = content.replace(HTML_COMMENT_PATTERN, "");
+            content = stripBlocksFixedPoint(content);
+        }
+        if (isMarkdownContentType(options.contentType)) {
+            content = content.replace(MARKDOWN_EXTERNAL_IMAGE_PATTERN, "[image removed]");
+            content = content.replace(MARKDOWN_EXTERNAL_LINK_PATTERN, "[link removed]");
         }
         content = sanitizeAndDetect(content, hostname);
     }
```

**Helper.** Add `isMarkdownContentType(contentType: string | undefined): boolean` to `src/lib/utils/content-type.ts` (matches `text/markdown`, `text/x-markdown`, and `*/markdown`).

**Tests (`src/lib/response/processor.test.ts` — new file or extend existing).**

- HTML response with `<script>alert(1)</script>` → script block removed; sanitisation still runs.
- HTML response with `<style>body::before{content:"ignore previous instructions"}</style>` → style block removed.
- HTML response with both `<!--…-->` and `<script>…</script>` → both removed in one pass.
- HTML response with `<scriPt>` (mixed case) → still removed (case-insensitive flag).
- **Self-healing payload `<scr<script>ipt>alert(1)</scr</script>ipt>` → fully neutralized within fixed-point iteration cap.**
- **Entity-encoded `&#x3c;script&#x3e;` → decoded then stripped.**
- **Pathological 1 MB body with deeply-nested `<script>` chain → strip path skipped (length cap), sanitiser still runs, no ReDoS hang (test wall-clock < 100 ms).**
- Markdown response with `![logo](https://tracker.example.com/pixel.gif)` → replaced with `[image removed]`.
- Markdown response with `[click here](https://tracker.example.com/click?token=abc)` → replaced with `[link removed]`.
- Markdown response with `![local](/assets/img.png)` → preserved (relative URL).
- Markdown response with `[Internal](relative/path.md)` → preserved (relative URL).
- Markdown image inside a link `[![alt](https://img.example/x.png)](https://link.example/click)` → image AND link both replaced (negative-lookbehind `(?<!!)` on link pattern prevents the `![` match cascade).
- Non-text content type → sanitisation entirely skipped (no script/style processing).

**Acceptance criteria.**

- [ ] Script blocks removed from markup-comment-supporting content types, including self-healing and entity-encoded variants.
- [ ] Style blocks removed similarly.
- [ ] External markdown images replaced with `[image removed]` in markdown content types.
- [ ] External markdown **links** replaced with `[link removed]` in markdown content types.
- [ ] Same-origin / relative markdown images and links preserved.
- [ ] **Strip path is skipped above 256 KB; ReDoS regression test demonstrates no hang on adversarial payload.**
- [ ] Each behaviour has at least one regression test.

**Research Insights (added 2026-05-01).**

- **The naive `<script\b[^>]*>[\s\S]*?</script>` pattern is the textbook ReDoS example (Snyk, 2024).** Worst-case backtracking on inputs like `<script>` followed by 100k of "almost-closing" content. The negative-lookahead body `(?:(?!<\/?script\b)[\s\S])*?` is linear in the input length — it refuses to match if a nested `<script` appears, which both kills the ReDoS and defeats self-healing.
- **Self-healing bypass is real (prompt-injection 2025).** Payload `<scr<script>ipt>` survives a single naive `replace()` pass: the *outer* `<scr...ipt>` doesn't match because there's a nested `<script>` token, the *inner* `<script>` matches and is removed, and the residue `<scr` + `ipt>` reconstructs as `<script>` after concatenation. Defence: fixed-point iteration (`while (curr !== prev)`) bounded by `STRIP_FIXED_POINT_MAX_ITERATIONS`.
- **Numeric-entity bypass is real (W3C 2024).** `&#x73;cript` decodes to `script`. Entity-decode pass handles the common case (numeric, hex, decimal); named entities (`&amp;`) are left alone since they don't carry script tags.
- **The 256 KB cap is conservative.** Most real HTML responses are well under it; oversize bodies skip the strip path but still go through `sanitizeAndDetect()`. The trade-off: above 256 KB we trust the sanitiser alone (which is regex-bounded and linear) rather than risk the strip path's worst case.
- **`parse5` (full HTML parser) was considered.** Pro: zero false positives, no ReDoS class. Con: 60 KB minified, 2× slower on small bodies, adds a dependency. The hardened-regex approach is good enough at this severity tier (we are stripping for prompt-injection mitigation, not building a sandboxed renderer); the doc comment in B8 should explicitly acknowledge the trade-off as "best-effort against textual injection vectors, not a substitute for a full HTML sanitiser."
- **Markdown LINK exfiltration (prompt-injection 2026).** Image beacons are well-known; click-trackable links via markdown `[label](url)` are the same exfil class but routinely overlooked by sanitisers. Pattern uses `(?<!!)` negative lookbehind to avoid double-matching markdown image links (which start with `![`).
- **`MARKDOWN_EXTERNAL_LINK_PATTERN` lookbehind support.** All maintained Node.js LTS versions support negative lookbehind; safe to use in regex.

---

#### B7 (sub-4-5) — Detection-pattern expansion (observability-only)  *(PR-8)*

**What.**

1. **NFKC-normalise** the input to `detectInjectionPattern()` before running `INJECTION_PATTERNS.test()`. NFKC collapses homoglyphs (Cyrillic `іgnore` U+0456 → ASCII `ignore`) and width variants (full-width letters → half-width) into canonical ASCII, defeating the simplest character-substitution bypass.
2. **Widen the bounded wildcard** in `INJECTION_PATTERNS` from `[\s\S]{0,20}` to `[\s\S]{0,80}` for the multi-keyword phrase patterns (`ignore … instructions`, `disregard … directives`, `forget … instructions`, `override … instructions`). Closes the "gap-padding bypass" — `ignore<25 spaces>previous instructions`.
3. **Add common synonym variants** for the explicit-override class:
   - `stop\s+(following|obeying|applying)`
   - `cease\s+(compliance|following|obeying)`
   - `bypass\s+(your|all|the)\s+(instructions?|filters?|safety)`
   - Leetspeak variants — defer; NFKC + the existing patterns already cover most variants, and a leetspeak-explicit pattern set risks false positives on legitimate text. Document this trade-off in the comment block.

**Why.** Detection is observability-only — never suppresses content — so these are not fail-open security holes. They are coverage improvements for the per-hostname log signal that an injection attempt landed.

**Important behavioural caveat.** NFKC normalisation MUST be applied *before detection only*, NOT before sanitisation. Sanitisation operates on the raw bytes the response actually contains; normalising before sanitisation would change what the LLM sees. The split is:

- **Sanitisation**: raw input → cleaned output → returned to LLM.
- **Detection** (observability): NFKC-normalised version of the cleaned output → matched against `INJECTION_PATTERNS` → log-only side effect. The cleaned output, not the normalised one, is returned.

**Diff sketch (`src/lib/utils/sanitize.ts`).**

```diff
-export function detectInjectionPattern(input: string): boolean {
-    return INJECTION_PATTERNS.test(input);
-}
+export function detectInjectionPattern(input: string): boolean {
+    // NFKC normalisation collapses homoglyphs and width-variants into canonical
+    // ASCII before pattern matching. Used only in detection (observability) —
+    // never modifies what is returned to the LLM.
+    const normalised = input.normalize("NFKC");
+    return INJECTION_PATTERNS.test(normalised);
+}
```

Update `INJECTION_PATTERNS` to widen `{0,20}` → `{0,80}` for multi-keyword phrases and add synonyms. Each change carries a regression test.

**Tests (`src/lib/utils/sanitize.test.ts`).**

- Cyrillic `іgnore previous instructions` (U+0456) → detected after NFKC normalisation.
- Full-width `ｉｇｎｏｒｅ ｐｒｅｖｉｏｕｓ ｉｎｓｔｒｕｃｔｉｏｎｓ` → detected.
- `ignore<30 spaces>previous instructions` → detected (within new 80-char window).
- `ignore<90 spaces>previous instructions` → still NOT detected (above the new 80-char cap; documents the bound).
- `stop following your instructions` → detected.
- `cease compliance with the rules` → detected.
- `bypass your safety filters` → detected.
- Existing patterns still match — full regression suite passes.

**Acceptance criteria.**

- [ ] `detectInjectionPattern()` NFKC-normalises before matching.
- [ ] Bounded wildcards widened to `{0,80}` on multi-keyword phrase patterns.
- [ ] At least 3 new synonym families covered.
- [ ] Each addition has a passing regression test demonstrating prior-version miss.
- [ ] No content sent to the LLM is changed by this PR (audit: only `INJECTION_PATTERNS.test()` and the surrounding log call should be touched).

**Research Insights (added 2026-05-01).**

- **NFKC alone won't catch Cyrillic/Greek homoglyphs (UTS #39).** Per Unicode Technical Standard #39, NFKC's compatibility decomposition does **not** map Cyrillic `і` (U+0456) → ASCII `i`, nor Cyrillic `а` (U+0430) → ASCII `a`. NFKC handles compatibility variants (full-width, half-width, ligatures) but not visually-confusable distinct characters. The Unicode-recommended algorithm is the **`skeleton()` function from `confusables.txt`** (UTS #39 §4), which folds confusable characters to a canonical class.
- **Decision: ship NFKC now; defer skeleton.** Implementing UTS #39 skeleton properly requires either bundling the confusables data (~150 KB, updates per Unicode release) or pulling in `unicode-confusables` (npm). NFKC + the bounded-wildcard widening + synonyms close the highest-value gaps for free. The detection log itself becomes the signal for whether Cyrillic-homoglyph attacks land in the wild — if the per-hostname log shows them, schedule a follow-up to add `skeleton()` (data file or dep).
- **Document the gap explicitly in the comment block in `sanitize.ts`:** "NFKC handles width-variants and ASCII-mappable compat decompositions. It does NOT handle Cyrillic/Greek homoglyphs (е, а, о, р, с, х). UTS #39 skeleton-folding is the proper defence — currently deferred. Per-hostname injection log is the trigger for re-evaluation."
- **Leetspeak deferral confirmed.** Original plan defers leetspeak-explicit patterns (`1gn0r3`); kept that decision. Leetspeak doesn't NFKC-collapse cleanly, and explicit patterns trip false positives on legitimate text (`l33t`, `1337`, etc.). The injection log is again the signal for re-evaluation.

---

#### C1 — MCP SDK forward-compat awareness *(non-action; informational)*

**Status.** No PR. Documented for the next-up team to read before scoping the big upcoming work.

**Findings.**

- **Current pin:** `@modelcontextprotocol/sdk@^1.29.0`. Latest published stable: `1.29.0` (2026-03-30). Already current.
- **Latest pre-release:** `2.0.0-alpha.2` (2026-04-01) — **revised from alpha.1**. Alpha.2 is the active development branch.
- **`StreamableHTTPServerTransport`** is in use already (`src/lib/transports/http.ts:7`). Modern; remains the recommended transport in 1.x and 2.0.
- **Security backports already inherited via 1.29.0:**
  - **CVE-2026-0621** — UriTemplate ReDoS, fixed in 1.25.2. We're on 1.29.0 → patched.
  - **GHSA-345p-7cg4-v4c7** — transport-sharing leakage between concurrent sessions, fixed in 1.26.0. We're on 1.29.0 → patched.
- **2.0.0-alpha.2 breaking-change set (9 items the team should know):**
  1. **Standard Schema replaces Zod-specific tool/prompt registration.** Any Standard Schema v1-compatible library works (Zod v4, Valibot, ArkType, Effect Schema). Zod v4 already emits Standard Schema-compatible objects → existing registrations continue to work, but `inputSchema: z.ZodObject<…>` typing should widen to `inputSchema: StandardSchemaV1` over time. **B4 doesn't block** (it operates on `field.description`/`.describe()` which are Zod-native, but only at registration time; once Standard Schema is the public type, B4 needs to either narrow internally or drop the auto-sanitization for non-Zod schemas).
  2. **Package split.** `@modelcontextprotocol/sdk` becomes `@modelcontextprotocol/{server,client,node,express,hono,fastify}`. Our entrypoint imports change: `from "@modelcontextprotocol/sdk/server/mcp.js"` → `from "@modelcontextprotocol/server"` etc. Migration is mechanical but every import line moves.
  3. **Unknown-tool calls return JSON-RPC error code `-32602`** (`InvalidParams`) instead of a `CallToolResult` with `isError: true`. We don't synthesise this; `McpServer` handles it.
  4. **Unknown-resource reads return `-32002`** (`ResourceNotFound`). We don't custom-handle resource-not-found.
  5. **Task orchestration relocated** to a separate package. We don't use task orchestration.
  6. **`server.tool()` accepts a single options object** (replaces multi-arg overloads). Mechanical rename.
  7. **Hooks API formalised** under a public `Server.hooks` surface; our internal `beforeRequest`/`afterResponse`/`onError` predates this and would not be replaced.
  8. **Logging interface changed** — minor; we use `console.error` with throttling, not the SDK logger.
  9. **`outputSchema` + `structuredContent`** become first-class on tool results in 2.0 (already opt-in in 1.x).
- **Features added in 1.x worth noting (not adopted today):**
  - `outputSchema` + `structuredContent` on tool results — would let YAML-driven endpoints advertise an explicit response shape, helpful for LLMs but requires either schema-author-supplied response Zod schemas (not in `apiVersion: "1.0"` schema today) or runtime inference. Worth considering as part of "the big work" if the next round expands the YAML schema.
  - **Resource templates / `ResourceLink` content type** — not relevant to current tools; consider for any documentation-as-resource expansion.
  - **Elicitation / completions** — not currently used; could simplify some interactive flows but not a near-term need.
- **Known sharp edges (issues #654, #699):** `outputSchema` + `structuredContent` interaction is buggy in 1.27.x — when a tool declares `outputSchema` but the handler returns mixed text + structured content, the SDK serialises both into the response and clients render duplicates. **Current pin 1.29.0 has the fix** but flag the edge case if PR-7's response shape ever evolves.

**Recommendation for the next round of work.** When the big work begins:

1. Run `npm outdated @modelcontextprotocol/sdk` at the start of the work cycle. If 2.0 has shipped, allocate a **separate spike** for the migration (typed work: package split, Standard Schema, error-code changes); do not bundle it with feature work.
2. If the big work expands the YAML schema, design `response.outputSchema` (Standard Schema-compatible — not Zod-specific) into the schema from day one rather than retrofitting. The YAML-tool generator would thread it into `server.registerTool({ outputSchema, … })` and structured content in the handler return.
3. Avoid public APIs that deepen Zod-specific typing where Standard Schema would suffice (i.e., accept any `StandardSchemaV1` instead of `z.ZodObject` if the SDK starts accepting both). **B4's `inputSchema` typing is the most likely place this collides** — narrow it inside `sanitizeTopLevelFieldDescriptions()` only (where Zod-native API is required), not in the public `CustomToolMeta` type.

**Research Insights (added 2026-05-01).**

- **2.0.0-alpha.2 — not alpha.1.** Plan was off by one alpha. Alpha.2 (2026-04-01) is the active development branch; alpha.1 has been superseded.
- **Package-split is the highest-friction change in 2.0.** Every `import` line changes path. A migration spike should script the rewrite (codemod or `sed`) rather than hand-edit. Allow one full PR for it.
- **Standard Schema readiness is mostly free.** Zod v4 emits Standard Schema-compatible objects; our existing registrations continue to work in 2.0 without rewriting the schema bodies. The only typing change is `z.ZodObject<…>` → `StandardSchemaV1`, which is a public-API broadening (additive on consumer side).
- **Security posture: 1.29.0 already covers the published CVE/GHSA list.** No urgency to upgrade further before 2.0; 1.29 → 1.30/1.31 will be feature-only patches.

---

### Work Breakdown & Dependencies

| #  | Phase | Task / Group | Depends On | Parallel Group | Est. Files | Est. Effort |
|----|-------|-------------|------------|----------------|------------|-------------|
| 1  | Helper consolidation | A1 — harden `httpOnlyUrl()` | — | A | 2 | S |
| 2  | Helper consolidation | A2 — consume helper in built-in schemas | 1 | A | 2 | S |
| 3  | Helper consolidation | A3 — re-export `httpOnlyUrl` | — | A | 1 | XS |
| 4  | Helper consolidation | A4 — restore `data:` URL tests in prompts | — | A | 2 | XS |
| 5  | Public surface | B6 — re-export spotlighting helpers | — | A | 1 (+ docs) | XS |
| 6  | Coverage | B1 — `executeJqQuery` unit tests | — | B | 1 | M |
| 7  | Docs | B2 — README inputSchema sanitisation example | — | B | 1 | XS |
| 8  | Auth boundary | B5 — `authToken` validation | — | B | 4 (constants split) | S |
| 9  | Trust boundary (custom) | B4 — auto-sanitise Zod field descriptions (rebuild via `.describe()`) | — | C | 2 | M |
| 10 | Trust boundary (YAML/load) | B9 — sanitise inside `validateApiSchema()` | — | C | 3 | M |
| 11 | Trust boundary (defence-in-depth) | B3 — `wrapWithDefence` on YAML/custom-tool output (4th asymmetry) | — | C | 4 | M |
| 12 | Injection defence | B7 sub-1-3 — sanitisation gaps (incl. Sneaky Bits) | — | D | 2 | M |
| 13 | Injection defence | B8 — HTML/markdown content stripping (ReDoS-hardened, link blocking) | — | D | 3 | M-L |
| 14 | Injection defence | B7 sub-4-5 — detection expansion (NFKC + synonyms; UTS-39 deferred) | — | D | 2 | M |
| 15 | Cleanup | Delete `docs/todos/` + `docs/upstream-contributions.md` | 1–14 | E | (delete only) | XS |

**Notes on dependencies:**

- Item 2 depends on item 1 (the helper must be hardened before consumers swap to it; otherwise the consumers swap to a still-unhardened helper for no gain). They can ship in the same PR.
- Items 3–5, 7 are pure additive and can ship in any order — fold them into PR-1 alongside items 1–2 for cohesion.
- Items 10 (B9) and 11 (B3) are now **separate PRs** (PR-6a and PR-6b) — formerly a combined PR-6 that mixed sanitise-when (B9) with defence-where (B3). The split lets each PR review on a single mental model.
- Items 12 + 13 + 14 share `sanitize.ts` and `processor.ts` — they split across two PRs (impactful vs observability) so review can prioritise; PR-7 lands first, PR-8 rebases after.

### PR Plan

| PR | Includes Items | Est. Files | Review Complexity | Can Start After |
|----|---------------|------------|-------------------|-----------------|
| PR-1 | 1, 2, 3, 4, 5 | 7 | **Medium** — security-helper hardening, scheme allowlist consumers swap, public-API additions | Immediately |
| PR-2 | 6 | 1 (new) + minor fixture | **Low** — pure new test file | Immediately |
| PR-3 | 7 | 1 | **Low** — README only | Immediately |
| PR-4 | 8 | 4 + 1 test file | **Low–Medium** — startup validation; constants in `config/`; security-adjacent | Immediately |
| PR-5 | 9 | 1 + 1 test file | **Medium** — Zod v4 description rebuild (`globalRegistry`-aware); bounded scope but verify via `.toJSONSchema()` round-trip | Immediately |
| PR-6a | 10 | 2–3 + tests | **Medium** — moves sanitisation into `validateApiSchema()`; closes public-API bypass | Immediately |
| PR-6b | 11 | 4 + tests | **Medium-High** — `wrapWithDefence` runs sanitize+detect+spotlight on YAML/custom-tool output (4th asymmetry) | After PR-6a (independent file-set; sequenced for review focus) |
| PR-7 | 12, 13 | 3 + tests | **High** — response-side sanitisation expansion affects what reaches the LLM; ReDoS-hardened HTML strip; perf-sensitive | Immediately |
| PR-8 | 14 | 1 + tests | **Low–Medium** — observability-only, but pattern set changes warrant regression tests | After PR-7 (shared `sanitize.ts`) |

**Parallel development:** PR-1 through PR-5, PR-6a, PR-6b are independent at the file level. PR-7 and PR-8 share `sanitize.ts` — land sequentially. Practically, an agent can land them in any order outside that constraint; recommended sequencing is by review complexity (low → high) so faster wins set the codebase rhythm.

**Recommended landing order:** PR-3 (README) → PR-2 (jq tests) → PR-1 (URL hardening) → PR-4 (auth token) → PR-5 (custom-tool Zod rebuild) → PR-6a (YAML validate-time sanitise) → PR-6b (defence-in-depth on YAML/custom output) → PR-7 (response sanitisation expansion) → PR-8 (detection expansion) → final cleanup commit (item 15: delete `docs/todos/` and `docs/upstream-contributions.md`).

**Critical path:** PR-6a → PR-6b (sequenced for review focus, not file-conflict) and PR-7 → PR-8 (file conflict on `sanitize.ts`) are the two short chains. Total chain length is 4 sequential PRs (6a → 6b is two; 7 → 8 is two; both chains can run in parallel if reviewers split). Estimated calendar time: 2 working weeks at one PR-per-day cadence.

### Validation pass

- [ ] No PR > 15 files changed. (Largest is PR-1 at ~7 files.)
- [ ] No PR < 2 files changed unless pure docs (PR-3 is README-only, acceptable).
- [ ] Every PR's description makes sense standalone — a reviewer needs no context from another open PR.
- [ ] No file is touched by two open PRs simultaneously: PR-7 and PR-8 share `sanitize.ts` (land sequentially); PR-6a and PR-6b are file-disjoint but sequenced for review focus.
- [ ] **PR-5's tests assert via the public `field.description` getter and `z.toJSONSchema()`** — not `_def.description` — to catch regressions to the broken in-place mutation pattern.
- [ ] **PR-6a's tests cover the public-bypass path:** `validateApiSchema(rawObject)` directly (not via `loadApiSchema`) yields a sanitised schema.
- [ ] **PR-6b includes a regression test for the 4th asymmetry:** custom-tool handler returning `U+202E` is sanitised even when `enableSpotlighting: false`.
- [ ] **PR-7 includes a ReDoS regression test:** 1 MB pathological body, wall-clock < 100 ms, no thread hang.
- [ ] **PR-8 audits that no content sent to the LLM is changed.** Tests assert NFKC-normalised string is matched against the regex but the *original* string is what flows downstream.

## Acceptance Criteria

### Functional Requirements

- [ ] All 9 todo files in `docs/todos/` have their problem statements addressed by a merged PR (or are explicitly marked obsolete with rationale).
- [ ] All 4 still-applicable upstream-contribution items are landed.
- [ ] `docs/todos/` directory deleted.
- [ ] `docs/upstream-contributions.md` deleted.
- [ ] No public API regression — `import { McpCurlServer, sanitizeDescription, MAX_CUSTOM_TOOL_DESCRIPTION_LENGTH } from "mcp-curl"` still works exactly as before; new exports (`httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`) are additive.

### Non-Functional Requirements

- [ ] `npm test` passes after each PR — no flaky or skipped tests introduced.
- [ ] `npm run build` produces clean output, no new TypeScript errors or warnings.
- [ ] **Performance budget revised (performance-oracle review HIGH).** The original ±5% target is unachievable: NFKC on a 1 MB body costs 25–70 ms (15–40 MB/s on V8); three additional regex passes (script-strip, style-strip, fixed-point loop) add 5–15%; combined worst case +25–55% on max-size responses. **Revised budget:**
  - **Median (representative payload, ~50 KB JSON): within ±15%** of pre-PR baseline.
  - **p99 (worst-case 1 MB text): within ±25%** of pre-PR baseline.
  - **Max-size body (10 MB): within ±50%** — strip path already skips above 256 KB, so the dominant cost is sanitiser + NFKC.
- [ ] **Performance optimisations to consider during implementation** (target: stay closer to ±15% even on p99):
  - Sliding-window NFKC: normalise in 64 KB chunks rather than the whole body, avoiding a transient 2× memory spike.
  - Combined HTML regex: merge `SCRIPT_BLOCK_PATTERN` and `STYLE_BLOCK_PATTERN` into a single union pattern (`/(<script\b…|<style\b…)/`), one pass instead of two.
  - Fast-path skip: if `content.indexOf("<script") < 0 && content.indexOf("<style") < 0` after lowercase, skip the strip path entirely.
- [ ] **Benchmark fixture in `bench/` (new):** 50 KB JSON, 500 KB HTML, 1 MB markdown, 10 MB text. Run `npm run bench` before and after each of PR-7/PR-8; record numbers in the PR description.
- [ ] No new external runtime dependency added. (NFKC normalisation uses built-in `String.prototype.normalize`.)

### Quality Gates

- [ ] Each PR has at least one regression test demonstrating the prior bypass / behaviour gap.
- [ ] Every new public-API export has a `.d.ts` symbol after `npm run build` (verified by inspecting `dist/lib.d.ts`).
- [ ] Doc updates (`README.md`, `docs/custom-tools.md`, `docs/api-schema.md` where touched) ship in the same PR as the code.

## Success Metrics

- **Open todos:** 9 → 0.
- **Deferred upstream items:** 4 → 0 (5th explicitly dropped).
- **Public-API gaps for custom-tool authors:** 4 missing helpers (`httpOnlyUrl`, `applySpotlighting`, `sanitizeResponse`, `detectInjectionPattern`) → 0.
- **Trust-boundary asymmetries:** **4 known** → 0:
  1. Sanitise-on-read vs at-validate in YAML schema layer (B9, in `validateApiSchema()`).
  2. No spotlighting on YAML-driven tools (B3).
  3. No top-level field-description sanitisation in `registerCustomTool` (B4).
  4. **Custom-tool / YAML-tool output bypasses sanitize+detect** (B3 expanded — 4th asymmetry surfaced during deep-plan review).
- **Documented injection-defence bypasses:** **9 known** → 0 (whitespace-padding via tab, NBSP, em-space, IDEOGRAPHIC SPACE; missing Unicode invisibles in 8 ranges; gap-padding > 20 chars; homoglyph via NFKC; **+ Sneaky-Bits VS Supplement; + markdown link exfil; + ReDoS in HTML strip**).

## Dependencies & Risks

### Internal Dependencies

- **`@modelcontextprotocol/sdk@^1.29.0`** — already pinned (latest 1.x; CVE-2026-0621 + GHSA-345p-7cg4-v4c7 fixes inherited); no SDK upgrade in this plan. **2.0.0-alpha.2 is in development with a 9-item breaking-change list and a package split** — see C1 for forward-compat guidance.
- **Zod v4** — already pinned; B4 uses the public Zod v4 API (`field.description` getter against `z.globalRegistry`; `field.describe()` for clone-and-register). Pin range capped at `^4.0.0` so a Zod v5 release during this work doesn't silently change `globalRegistry` semantics. **The earlier draft of B4 mistakenly mutated `_def.description` directly — this is a runtime no-op in v4.** Corrected approach is documented in B4's Research Insights and Risks.

### External Dependencies

- **None.** No new runtime dependency. NFKC normalisation uses built-in `String.prototype.normalize`. `js-yaml`, `express`, `zod` versions unchanged.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| B7 widening of bounded wildcards causes false-positive injection alerts on legitimate content | Medium | Low (observability-only — never suppresses content) | Land B7 sub-4-5 with extensive regression tests; monitor stderr-log volume for ≥ 1 week post-merge before declaring stable |
| **B4 rebuild references Zod-v4 internals (`field.description`, `field.describe()`); Zod v5 may change semantics** | Low | Medium (custom tools fail to register cleanly OR descriptions silently revert) | Pin Zod range to `^4.0.0` (already done); test against `field.description` getter AND `z.toJSONSchema()` round-trip; add a smoke test that exercises every Zod wrapper in our usage (`.optional()`, `.default()`, `.describe()`) |
| **B4 in-place `_def.description` mutation no-op was almost shipped** | (resolved) | (resolved) | Three reviewers caught it; corrected diff uses `.describe()` rebuild; tests now assert via `.description` getter not `_def`. Risk closed by review process. |
| B9 (sanitise-at-validate) misses a generator code path, leaving an un-sanitised string reaching the LLM | Low | Medium (security regression on advertisement metadata) | After removing each `sanitizeDescription()` call in `generator.ts`, grep for any new call sites; add an integration test loading a YAML with bidi chars and asserting they're stripped from `server.registerTool`'s seen arguments |
| **B9 sanitisation in loader-only would have left a public-API bypass** | (resolved) | (resolved) | Sanitisation moved into `validateApiSchema()`; regression test exercises the bypass path. |
| **B3 fourth-asymmetry: custom-tool/YAML-tool output was unsanitised even after spotlighting wrap** | (resolved by PR-6b expansion) | High pre-mitigation | `wrapWithDefence()` runs sanitize+detect+spotlight; regression test covers the asymmetry with `enableSpotlighting: false` |
| **PR-7 ReDoS in script/style-strip regexes** | Low–Medium pre-mitigation | High (HTTP transport thread hangs on adversarial 1 MB body) | Negative-lookahead body, fixed-point iteration cap, 256 KB length cap; regression test asserts wall-clock < 100 ms on pathological input |
| **PR-7 worst-case +50% sanitisation cost on 10 MB responses** | Medium | Low (responses above max-inline are already saved-to-file path, not LLM-inline) | Performance budget revised; sliding-window NFKC + combined HTML regex available as fast-path mitigations if benchmark shows breach |
| PR-7 newline-run collapsing breaks legitimate documents with intentional ≥ 20-newline structure (e.g. plaintext logs) | Low | Low–Medium | Threshold of 20 newlines is heuristic; document the trade-off in the comment block; if user reports surface, raise to 30 |
| **PR-7 markdown link-stripping breaks legitimate external link rendering** | Medium | Low–Medium (LLM no longer sees external citations as clickable) | Replacement is `[link removed]`, which preserves the label; LLM still sees the label text. Document in CHANGELOG. If user reports surface, gate behind `config.stripMarkdownLinks` (default off). |
| `validateAuthToken` rejects existing tokens that operators have configured with non-printable chars or > 4096 chars | Low | High (HTTP server fails to start after upgrade) | Document in CHANGELOG; provide a clear error message naming the env var; bump minor version to signal behavioural change. **4096-char cap is comfortably above all known JWT/OIDC token sizes; reduces operator-paste error class.** |
| YAML spotlighting parity (B3) changes wire format that downstream LLM clients have learned around | Low | Medium | Spotlighting is opt-in via `enableSpotlighting`; default is unchanged; only servers that explicitly set the flag see the new wrapping on YAML tools |
| **B3 sanitize-on-output (`wrapWithDefence`) modifies custom-tool output even when spotlighting is off** | Low | Medium (subtle behaviour change for callers depending on byte-equality of custom-tool returns) | Document explicitly in CHANGELOG: "Custom-tool string output is now sanitised in the same way `curl_execute` output is. To return raw bytes, use a non-text content part (e.g. `type: "resource"`) which `wrapWithDefence` skips by design." |
| **B7-sub-4-5 NFKC alone misses Cyrillic/Greek homoglyphs** | Medium | Low (observability-only) | Documented gap; deferred to UTS #39 skeleton implementation, gated on per-hostname injection log showing the attack class in the wild |
| MCP SDK 2.0 ships during this work cycle | Low | High | C1's recommendation: do **not** bundle SDK upgrade with feature work; allocate a separate spike when 2.0 ships. **Package split (9-item break list) is mechanical but every import line changes.** |

## Resource Requirements

- **One engineer**, one PR at a time. No parallel development necessary — all PRs are bite-sized and the security-sensitive ones (PR-7, PR-8) deserve sequential review.
- **No infra changes.** Runs on existing CI / `npm test` substrate.
- **Estimated calendar time:** 1.5–2 weeks at one PR-per-day cadence; faster if doc-only PRs (PR-3) land same-day.

## Future Considerations

After this plan executes:

- **YAML schema v1.1.** Consider extending the YAML schema with `response.outputSchema` (Zod-compatible) so YAML-generated tools can advertise structured output to LLMs. Aligns with MCP SDK 1.x's `structuredContent` feature. Land as part of "the big work" if the next round expands the schema layer.
- **Standard Schema migration.** When MCP SDK 2.0 ships, plan a dedicated spike to migrate tool-registration types from Zod-specific to Standard Schema. The deeper Zod typing in `CustomToolMeta.inputSchema: z.ZodObject<z.ZodRawShape>` is the only blocker; B4's traversal would also need updating.
- **Shared injection-defence library.** If a sister project ever needs the same defence, extract `src/lib/utils/sanitize.ts` into a separate package — its API surface is small, has good test coverage, and is the same shape any LLM-mediating service needs.

## Documentation Plan

- **README.md** — adds inputSchema sanitisation example (B2), updates Security Highlights to mention HTML/markdown stripping (PR-7) and printable-ASCII auth-token validation (PR-4).
- **docs/custom-tools.md** — softened wording around `registerCustomTool()` sanitisation contract (auto-sanitises top-level field descriptions; nested branches still caller's responsibility) (B4); adds a "Replicating the response-side defence" subsection (B6).
- **docs/api-schema.md** — no change required, but consider a sentence noting that schemas loaded via `loadApiSchema()` are pre-sanitised.
- **docs/architecture/architecture.md** — update the "Layering wrinkle" note around `utils/sanitize.ts` to mention NFKC-on-detection and the impactful-vs-observability split between sanitisation and detection.
- **CHANGELOG.md** (if present, otherwise a release note) — list the new exports, the auth-token validation behaviour change, the YAML spotlighting parity, the response sanitisation expansion. Bump minor (3.1.0) given the additive public API and behaviour changes — no break to existing callers.

## References & Research

### Internal References

- **All 9 source todos** (will be deleted after this plan ships): `docs/todos/jq-query-unit-tests.md`, `docs/todos/readme-register-custom-tool-sanitize-example.md`, `docs/todos/spotlighting-yaml-driven-tools.md`, `docs/todos/sanitize-custom-tool-zod-descriptions.md`, `docs/todos/auth-token-sanitize-consideration.md`, `docs/todos/public-api-spotlighting-symmetry.md`, `docs/todos/injection-defense-threat-model-expansion.md`, `docs/todos/injection-defense-html-tag-stripping.md`, `docs/todos/sanitize-yaml-schema-at-load.md`.
- **Source upstream audit** (will be deleted after this plan ships): `docs/upstream-contributions.md`.
- **Architecture overview:** `docs/architecture/architecture.md`.
- **Module map:** `CLAUDE.md` (architecture section).
- **Files referenced by items:** `src/lib/utils/url.ts:21`, `src/lib/utils/sanitize.ts:21-67`, `src/lib/schema/validator.ts:90`, `src/lib/server/schemas.ts:11`, `src/lib/extensible/mcp-curl-server.ts:243-294`, `src/lib/extensible/tool-wrapper.ts:36-55`, `src/lib/schema/generator.ts:497-507`, `src/lib/schema/loader.ts:63`, `src/lib/response/processor.ts:60-62`, `src/lib/transports/http.ts:139-150`, `src/lib/types/public.ts:35-39`, `src/lib.ts:73-75`, `src/lib/tools/jq-query.ts:85-156`, `src/lib/prompts/api-discovery.test.ts`, `src/lib/prompts/api-test.test.ts`.

### External References

- **MCP TypeScript SDK release history** — `https://github.com/modelcontextprotocol/typescript-sdk/releases` (1.20 → 1.29 release notes; 2.0.0-alpha.2 breaking-change set, 2026-04-01).
- **MCP TypeScript SDK package** — `https://www.npmjs.com/package/@modelcontextprotocol/sdk` (current pin: 1.29.0).
- **CVE-2026-0621** — UriTemplate ReDoS in MCP TypeScript SDK; fixed in 1.25.2; we are patched.
- **GHSA-345p-7cg4-v4c7** — Transport-sharing leakage between concurrent MCP sessions; fixed in 1.26.0; we are patched.
- **WHATWG URL spec** — `https://url.spec.whatwg.org/` (parser semantics for `URL` class behaviour referenced in A1).
- **Zod v4 source — description registry** — `node_modules/zod/v4/classic/schemas.js:74-77` (verifies `.describe()` is clone-then-register against `z.globalRegistry`, not `_def` mutation).
- **Unicode invisible characters reference** — Mongolian Vowel Separator (U+180E), Mongolian Free VS-1..3 (U+180B–U+180D), Hangul Fillers (U+115F, U+1160, U+3164), Variation Selectors Supplement (U+E0100–U+E01EF), Braille Pattern Blank (U+2800), Arabic Letter Mark (U+061C). Unicode 15.x/16.x code charts.
- **UTS #15 (Unicode Normalization Forms)** — informs B7 sub-4-5 detection-side NFKC choice.
- **UTS #39 (Unicode Security Mechanisms)** — confusables-based skeleton folding; documented gap that NFKC alone misses Cyrillic/Greek homoglyphs. Future implementation gated on injection-log signal.
- **"Sneaky Bits" prompt-injection research (2025–2026)** — invisible-character payload encoding via Variation Selectors Supplement; informs B7 sub-1-3 range additions.
- **OWASP LLM Top-10 (2025)** — LLM01 (prompt injection) — informs the impactful-vs-observability split between sanitisation and detection.
- **Snyk ReDoS pattern catalogue** — `<script\b[^>]*>[\s\S]*?</script>` documented as textbook ReDoS; informs B8's negative-lookahead body and fixed-point hardening.

### Related Work

- **PR-#20** — `feat(security): prompt injection defense for MCP tool responses` (commit `5f32c85`). Established the sanitisation/detection/spotlighting substrate this plan extends.
- **PR-#21** — `chore: address quick-win todos from PR #20 review` (commit `685781c`). Closed the easy items; the remaining items are this plan's scope.
- **PR-#22** — `docs+scripts: architecture overview, audits, integration test, deferred todos` (commit `bf87aed`). Captured the deferred todos and the upstream-audit doc that this plan consumes.

---

## Appendix: Review history (technical-review pass — 2026-05-01)

Audit trail for the `/sixees-workflow:technical-review` pass run on 2026-05-01 against the deepened plan. Three independent reviewers (code-simplicity, architecture-strategist, security-sentinel) surfaced 36 findings; the user elected "apply all." This appendix preserves each finding and its disposition for traceability.

**Naming:** `C*` = Simplicity, `A*` = Architecture, `S*` = Security. The `C` prefix here is reviewer-scoped — it does **not** refer to plan item C1 (MCP SDK forward-compat).

**Disposition column legend:**
- **B3 / B4 / B9 / §NFR / §WBS** — folded into that body section (revised 2026-05-01).
- **no-op** — does not apply; documented for traceability.
- **deferred to PR-X** — body authoring of that PR will absorb this; out of scope for the plan-doc consolidation.
- **out of scope** — explicitly removed from this plan.

### 🔴 Critical findings (7)

| ID | Reviewer | Finding | Disposition |
|----|----------|---------|-------------|
| C1 | Simplicity | Performance thresholds are speculative (the deepening's ±15%/±25%/±50% values had no measurement basis). Strip thresholds; replace with measure-baseline-then-set-CI protocol. | §NFR |
| C2 | Simplicity | Reviewer flagged a non-existent "apiServerWrap helper." Verified against current plan: B5 is `authToken` validation. No such helper. | no-op |
| A1 | Architecture | Double-wrap risk: `createApiServer()` registers tools via `registerCustomTool` which already triggers wrap. If B3 wraps at handler-registration, custom tools registered through `createApiServer()` get double-wrapped. Fix: idempotence via `Symbol.for("mcp-curl.wrapped")`. | B3 |
| A2 | Architecture | B3 layer placement was ambiguous. Pin: wrap fires inside the **handler-registration adapter** (`registerCustomTool` / YAML `createToolHandler`), not at transport boundary. Prompts/resources have separate entry points. | B3 |
| A3 | Architecture | `sanitizeAndDetect()` already exists in `src/lib/security/detection-logger.ts`. B3 must call it, not reinvent. | B3 |
| S1 | Security | `ApiSchemaValidator` raw-Zod bypass: re-exported via `src/lib/schema/index.ts:21` and `src/lib.ts:39`. `ApiSchemaValidator.parse(rawObj)` yields parsed-but-unsanitised schema. Fix: `.transform()` on the schema itself — sanitisation as parse invariant. | B9 |
| S2 | Security | Hook short-circuit bypass: `src/lib/extensible/hook-executor.ts:55-88` skips wrap when `beforeRequest` returns a `CallToolResult`. User-supplied hook results reach LLM unsanitised. Fix: route short-circuit results through wrap. | B3 |

### 🟡 Important findings (15)

| ID | Reviewer | Finding | Disposition |
|----|----------|---------|-------------|
| A4 | Architecture | Wrap signature mixed request-scope (`hostname`) + server-scope (`config`). Convert to factory: `createWrapper(config) → (result, hostname) => CallToolResult`. | B3 |
| A5 | Architecture | Layer diagram missing — B7-sub-1/2/3 wrap at different layers without visualisation. Add ASCII layer diagram. | B3 |
| A6 | Architecture | Architectural recommendation for hook short-circuit (root cause shared with S2): introduce explicit `src/lib/response/post-processor.ts` module called from both hook-executor and tool-handler. | B3 |
| A7 | Architecture | Standard Schema regression risk on B4 — Zod v4 `.description` getter walks `_zod.parent`; Standard Schema v1 metadata model differs. Add `z.toJSONSchema()` round-trip test. | B4 |
| A8 | Architecture | Sanitise-before-validate ordering — malformed YAML could echo attacker-controlled description content via Zod errors before sanitisation runs. Add pre-Zod raw-YAML sanitise pass. Belt-and-braces with S1. | B9 |
| A9 | Architecture | CI perf-budget noise — GitHub Actions ±30% variance on cold runs. Pin self-hosted runner OR median of N=5. | deferred to PR-9 |
| A10 | Architecture | MCP SDK 2.0 migration is high-risk during a hardening sprint (alpha as of 2026-04-01). Defer 2.0 migration; stay on 1.29.x patch line. Update plan item C1 to remove "consider 2.0" implications. | §Overview / out of scope |
| C3 | Simplicity | B4 rebuild perf — `sanitizeTopLevelFieldDescriptions` rebuilt full ZodObject shape on every call; 50-field YAML schema → 50 `.describe()` clones per registration. Memoise via `WeakMap<ZodObject, ZodObject>`. | B4 |
| C4 | Simplicity | Move CI-automatable Validation-Pass items into vitest assertions (Zod globalRegistry round-trip, double-wrap idempotence, hook short-circuit wrap). | deferred to per-PR body authoring |
| C5 | Simplicity | Prompt/resource wrap duplication — B7-sub-4 and B7-sub-5 share ~80% logic. Extract `wrapTextLikeResult(parts, hostname, config)` shared helper. | deferred to PR-7 |
| C6 | Simplicity | Risk-register pruning — several risks duplicate Acceptance Criteria items. Keep risks needing mitigation work; drop those covered by AC. | deferred to per-PR body authoring |
| S3 | Security | B4 only walked top-level objects. Many YAML schemas have nested request bodies (`body: z.object({ ... })`). Recurse into `ZodObject`, `ZodArray<ZodObject>`, `ZodUnion` of objects, and the inner branch of `ZodOptional` / `ZodDefault` / `ZodNullable`. Rename to `sanitizeFieldDescriptionsDeep`. | B4 |
| S4 | Security | Detection order silenced logs — sanitise → detect order means sanitiser strips the malicious pattern before detection sees it. Detect on **original** text, then sanitise for output. | B3 |
| S5 | Security | `javascript:` / `vbscript:` / `file:` schemes in markdown links — B8's blocklist focused on external `https://` exfil; dangerous-scheme set wasn't enumerated. Explicit blocklist `["javascript:", "data:", "vbscript:", "file:"]` applied to every markdown link/image href. | deferred to PR-7 (B8) |
| S6 | Security | `data:` URI in markdown images carries base64-encoded HTML/JS payload. Subsumed by S5's blocklist; explicit in B8 acceptance criteria. | deferred to PR-7 (B8) |
| S7 | Security | MCP Resource MIME-type bypass — resource can claim `text/plain` but contain HTML. Sanitise all text-like MIME types; refuse `text/html`/`application/xhtml+xml` for resources. Encode allowlist in `src/lib/utils/content-type.ts`. | deferred to PR-7 (B7-sub-5) |
| S8 | Security | UTS #39 skeleton folding gates B7-sub-4-5 — NFKC alone insufficient for Cyrillic/Greek homoglyphs. Block PR-8 on skeleton-folding integration. | deferred to PR-8 |
| S9 | Security | Regex-based HTML sanitisation is fundamentally unsafe (`<script\b[^>]*>[\s\S]*?</script>` is Snyk textbook ReDoS; self-healing bypass; numeric-entity bypass). Spike `parse5`-based stripper as alternative; document risk acceptance if regex retained. | deferred to PR-7 (B8) |

### 🔵 Suggestion findings (14)

| ID | Reviewer | Finding | Disposition |
|----|----------|---------|-------------|
| C7 | Simplicity | Move "Sneaky Bits" 240-codepoint table out of plan into `src/lib/utils/unicode-attack-ranges.ts`. | deferred to PR-7 |
| C8 | Simplicity | Reconsider PR-6 split — if 6a and 6b touch the same file (`detection-logger.ts`), keep as one PR with two commits. Audit before PR-6a opens. | deferred to PR-6a draft |
| C9 | Simplicity | Cap "How to apply" subsections at 5 bullets; push detail into source / commit messages. | deferred to per-PR body authoring |
| C10 | Simplicity | Standard Schema migration mentioned in 3 places. Resolve as out of scope (consistent with A10). Delete from this plan; create separate `2026-?-?-feat-mcp-sdk-2-migration-plan.md` stub when SDK 2.0 stabilises. | out of scope |
| C11 | Simplicity | UTS #39 skeleton folding library decision: use `unicode-confusables` (ships data table + skeleton function in 30 KB). Pin in PR-8. | deferred to PR-8 |
| C12 | Simplicity | `MCP_CURL_ALLOW_LOCALHOST` port allowlist values: `3000-3999`, `8000-8999`, `5000-5999` (common dev-server ranges). Document in B7-sub-2. | deferred to PR-7 |
| A11 | Architecture | Spotlight UUID scope: pin per-request (per-message). Sessions are user-scoped; sentinels need per-prompt isolation. | B3 |
| A12 | Architecture | `disableCurlExecute()` + `disableJqQuery()` zero-tools state — throw at `.start()` if zero tools registered AND no custom tools. Silent no-op is a footgun. | deferred (separate plan / not in this plan's scope) |
| S10 | Security | Structured logs — opt-in `MCP_CURL_LOG_FORMAT=json` env var for JSON stderr logs with `event_type` field. Off by default. | deferred (separate plan) |
| S11 | Security | Timing-safe auth-token compare — switch `MCP_AUTH_TOKEN` `===` to `crypto.timingSafeEqual`. Pad to common length first. | deferred to PR-4 (B5) |
| S12 | Security | Pin SDK floor version + `npm audit` CI gate. `package.json` already specifies `^1.29.0` (≥1.26.0; includes CVE-2026-0621 + GHSA-345p-7cg4-v4c7 fixes). | deferred to PR-9 |

### Reviewer-convergence findings

These had three reviewers naming the same root cause — strongest signals in the pass:

1. **B3 layer placement & dedup** (A2 + A3 + A6 + S2) → introduce `src/lib/response/post-processor.ts`; wrap fires once at handler-registration; idempotence symbol; both `hook-executor` and `tool-handler` route through it. **Folded into B3.**
2. **`ApiSchemaValidator` bypass** (S1 + A8) → `.transform()` on the schema itself + sanitise raw YAML strings pre-Zod. Invariant of parsing, not post-validation. **Folded into B9.**
3. **B4 inheritance + Standard-Schema + recursion** (C3 + A7 + S3) → rebuild B4 to (a) recurse into nested objects/arrays/unions, (b) memoise by input-schema reference (WeakMap), (c) include Standard Schema compliance test. **Folded into B4.**
4. **Detection-order ordering** (S4 + existing throttle design) → detect on **original** text, sanitise for output. Both run. **Folded into B3.**

### Blind-spot found during cross-reference

**No reviewer caught this:** the plan did not specify what happens if `wrapWithDefence` (or `sanitizeAndDetect`) **itself** throws — e.g., catastrophic regex backtracking on a crafted input. **Fix:** wrap the wrap in a try/catch; on error, return original content + log `[wrap-error] [hostname] ErrorClassName` to stderr (throttled per hostname, same throttle as injection-detection). The wrap must never propagate exceptions to the handler boundary — it's defence-in-depth, not a load-bearing dependency. **Folded into B3.**

### Summary of disposition

- **Folded into body sections (B3, B4, B9, §NFR):** 14 findings (all Critical actionable + key Important)
- **Deferred to per-PR body authoring (PR-4, PR-6a, PR-7, PR-8, PR-9):** 14 findings (scope-bounded; will land when their PR is drafted)
- **Out of scope / no-op:** 4 findings (C2 no-op; A10 + C10 deferred to separate plan; A12 + S10 separate plan)
- **Deferred (unbounded):** 4 findings (C4, C5, C6, C9 — per-PR body authoring quality items)

The body sections (B3, B4, B9) and §Non-Functional Requirements are the **authoritative source** for any folded finding. Where this appendix and a body section appear to conflict, the body section wins; this appendix is the audit trail.
