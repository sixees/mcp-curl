---
id: 020
title: "A save failure after the HTTP request completed is reported as a request failure, inviting a retry that re-applies a non-idempotent mutation"
status: open
severity: P3
tags: [error-channel, pre-existing, data-integrity]
class-id: unwrapped-multi-write
source: /sixees-workflow:work Surface 2 round on fix/012-saved-files-can-silently-overwrite (data-integrity-guardian)
reviewers: [data-integrity-guardian]
created: 2026-09-08
pr: ""
---

# A save failure after the request is reported as a request failure

## Problem

`executeCurlRequest` runs the request, then `processResponse` → `saveResponseToFile`.
Any write error propagates to the single outer `catch`, which returns
`isError: true` with the text `Error executing cURL request: <msg>`.

For a `POST`/`PUT`/`DELETE` the remote mutation **has already applied**. The
response bytes are discarded and unrecoverable, and the caller is told the
*request* errored — which invites a retry that double-applies the mutation.

The failure is in the error channel's *subject*, not in its control flow. The
save failure is legible (the message names the code); it is attributed to the
wrong operation.

## Evidence

- `src/lib/tools/curl-execute.ts::executeCurlRequest` — the trailing
  `catch (error)` conflates pre-request and post-request failures. Reached from
  `src/lib/response/processor.ts::processResponse`'s `await saveResponseToFile(...)`
  with nothing in between.
- `src/lib/tools/jq-query.ts::executeJqQuery` has the identical catch shape and is
  **not** an instance: it is `readOnlyHint: true` with no external effect, so a lost
  save is recoverable by re-running the query. Ruled out by reading, not assumed.

## Why P3 and not higher

The realistic triggers are pre-existing and were not introduced by
`docs/todos/012`: `ENOSPC`, `EACCES`/`EROFS` on an operator-supplied `output_dir`,
`EDQUOT`. 012 added `EEXIST` as one further trigger on the line it modified, and
**that half is declined rather than deferred** — reaching it needs 32 bits of
`randomUUID` to repeat inside one millisecond under an identical `safeName`, so
the population is empty.

What survives is the mislabelled channel on the pre-existing triggers. Population,
named rather than assumed: an operator using `output_dir` on a full or read-only
volume, plus a model that reads "Error executing cURL request" as "retry it".
Real, and small.

## Fix

**Not a retry loop.** `LESSONS.md` RC-53 settled that — acceptance criterion 5 of
`docs/todos/012` asks for a collision to surface as an error, and reopening it
would be the reversal `.claude/rules/03-divergence.md` → *Settled conflicts stay
settled* covers. Cite RC-53 rather than re-litigating.

Catch the save failure where it happens and report the subject correctly — e.g.
*"request succeeded; saving the response failed (`<code>`) — do not retry the
request"* — so a non-idempotent call is not replayed on a full disk.

## Trigger to revisit

Any of:

- A consumer reports a duplicated `POST`/`DELETE` following a save failure.
- Work lands in `src/lib/tools/curl-execute.ts`'s error path for any other reason
  — fix it in passing rather than in its own branch.
- `src/lib/response/processor.ts`'s save arm gains a second failure mode whose
  subject would also be mis-attributed.

## Acceptance criteria

- [ ] `executeCurlRequest` with `save_to_file: true` and a write that fails
      (`output_dir` made read-only mid-test, or `writeUniqueFile` mocked to reject
      `EACCES`) returns a message naming a **save** failure, not a request failure.
- [ ] The message states that the request itself succeeded, so a retry is not
      invited.
- [ ] A pre-request failure still reports as a request failure — the two subjects
      are distinguishable in both directions, not just the new one.
