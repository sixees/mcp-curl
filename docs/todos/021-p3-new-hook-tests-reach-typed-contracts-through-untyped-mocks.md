---
status: pending
severity: low
effort: s
tags: [code-review, convention-drift, tests, extensible, hooks]
dependencies: []
pr: ""
---

# New hook tests reach typed hook contracts through untyped mocks

**Class:** `convention-drift` · **Severity:** P3 · **confidence:** medium
**Found by:** typescript-reviewer. Filed from `/sixees-workflow:review` of branch
`fix/015-wrap-every-handler-exit` (commit 3bc9e17), Surface 2.

## Problem Statement

The new tests in `tool-wrapper.test.ts` build their `onError` hook and executors as bare
`vi.fn()` / `vi.fn() as never`, so an assertion on the hook contract's shape compiles as
`any`. The sibling e2e file in the same diff uses `vi.fn<CurlToolExecutor>()` and gets the
typecheck for free. `npm run typecheck` is the one gate `CLAUDE.md` names as seeing type
errors in tests; these tests bypass it for the contract they exist to pin.

## Findings

- `src/lib/extensible/tool-wrapper.test.ts::registerWith` — `const onError = vi.fn();`
  (typed `Mock<(...args: any[]) => any>`) and `executor: executor as never`; consumed as
  `onError.mock.calls[0][0].error` in the three throw tests of the *"throwing hooks and
  executors leave through the wrap"* describe. — **confirmed**
- `src/lib/extensible/tool-wrapper.test.ts` → *"a disabled tool's refusal leaves through
  the wrap"* (both `it` blocks) — `executor: vi.fn() as never`. — **confirmed**
- Failure: `OnErrorHook`'s `error` field is renamed or re-typed later; typecheck stays
  green; the three throw tests fail at runtime with "expected undefined to be Error", and
  the author learns from vitest what the compiler would have said.
- Root: symptom — the file's older tests set the `vi.fn() as never` idiom and the new code
  copied the file's convention rather than the e2e file's. Test-only; no production `any`.
- Sweep: `rg "as never|mock\.calls\[0\]\[0\]" src/**/*.test.ts` — 36 candidates → 2
  confirmed as new; the other 15 `as never` casts in `tool-wrapper.test.ts` and the
  `handler as never` in `mcp-curl-server.test.ts` are pre-existing idiom (context only).
  The casts hide no signature mismatch today: `() => { throw error; }` is `() => never`,
  assignable to `BeforeRequestHook`; `vi.fn().mockRejectedValue(error)` is assignable to
  `CurlToolExecutor`.

## Proposed Solutions

### Option 1: Type the mocks in the new tests

**Approach:** `const onError = vi.fn<OnErrorHook>();` and `vi.fn<CurlToolExecutor>()` for
the executors (both types already exported), which makes every `as never` on `executor:` in
the new blocks unnecessary.

**Pros:** renaming `error` on `OnErrorHook` then fails `npm run typecheck` rather than
`vitest run`. **Cons:** the older tests in the same file keep the old idiom, so the file
holds two conventions until someone sweeps it. **Effort:** minutes. **Risk:** Low.

### Option 2: Sweep the whole file to the typed idiom

**Approach:** Option 1 plus the 15 pre-existing `as never` casts in the same file.

**Pros:** one convention per file. **Cons:** touches tests this change did not write;
out of scope for the branch. **Effort:** under an hour. **Risk:** Low.

## Recommended Action

_Filled when dispositioned._

## Technical Details

**Affected files:**
- `src/lib/extensible/tool-wrapper.test.ts::registerWith` and the two disabled-tool `it`
  blocks
- Reference idiom: `src/lib/extensible/tool-wrapper.e2e.test.ts::okExecutor`

**Test:** none new — the finding is that the three existing throw tests become
compile-time checked.

## Resources

- Branch `fix/015-wrap-every-handler-exit`, commit 3bc9e17; handoff
  `docs/work/handoff-fix-015-wrap-every-handler-exit.md`
- `CONVENTIONS.md` → *Tests* ("Test what static analysis cannot see")

## Acceptance Criteria

- [ ] `onError` in `registerWith` is `vi.fn<OnErrorHook>()`
- [ ] No `as never` on an `executor:` in the two new describe blocks
- [ ] `npm run typecheck` and `vitest run src/lib/extensible/tool-wrapper.test.ts` both
      pass

## Work Log

### 2026-11-04 - Filed from review

**By:** Claude Code (/sixees-workflow:review, orchestrating for /sixees-workflow:work)

**Actions:** filed as returned; instances confirmed by the reviewer by reading.

**Learnings:** the new tests copied the host file's cast idiom; the e2e sibling in the same
diff shows the typed form costs nothing.
