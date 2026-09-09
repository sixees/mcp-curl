// src/lib/response/cpu-time.test-fixture.ts
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file. Every other module in this directory is
// production code on the strip path, so the name is the only thing separating
// them — and `file-saver.test.ts`'s production sweep, which enforces invariant
// 17, exempts this suffix by name. `CONVENTIONS.md` → *Naming* owns the rule.
import { isMainThread } from "node:worker_threads";

/**
 * CPU milliseconds consumed by `work` — the quantity the invariant-15 timing
 * guards are about.
 *
 * **Wall clock is not a proxy for it.** `Date.now()` keeps counting while the
 * worker is descheduled, so beside the suite's own parallel workers it measures
 * the host's load rather than the pattern's cost: cases costing 6-22 ms of CPU
 * read 124-161 ms of wall clock under contention and failed a 100 ms budget. No
 * margin closes that — a descheduled measurement is unbounded however wide the
 * budget is — which is why the answer is a different clock rather than a larger
 * number.
 *
 * **CPU time is not perfectly load-invariant either, and the budget has to
 * allow for it.** Memory-bandwidth contention shows up as real cycles: the
 * slowest flood measures ~22 ms idle and ~53 ms beside 72 CPU hogs. That is a
 * 2.4x spread rather than the 20x-plus a wall clock shows, which is what makes
 * a budget possible at all — not a claim that the reading is fixed.
 */
export function cpuMs(work: () => unknown): number {
    assertOwnProcess();
    const started = process.cpuUsage();
    const returned = work();
    const spent = process.cpuUsage(started);
    assertMeasuredToCompletion(returned);
    return (spent.user + spent.system) / 1000;
}

/**
 * The clock stops when `work` RETURNS, which for an `async` body is its first
 * `await` — so a promise here means the reading covers a synchronous prefix and
 * the budget is being compared against microseconds.
 *
 * **Checked at runtime because the type system will not do it.** A callback
 * typed `() => void` accepts a promise-returning function by TypeScript's
 * void-return assignability, deliberately, so `strict`, `tsc` and the lint pass
 * all stay silent — which leaves a guard that passes for every input, including
 * one that backtracks for thirty seconds. `() => unknown` is honest about what
 * arrives and this is what rejects it. Measuring an async body needs a second
 * clock that samples across the `await`; there is no caller for one yet.
 */
function assertMeasuredToCompletion(returned: unknown): void {
    const thenable =
        typeof returned === "object" &&
        returned !== null &&
        typeof (returned as { then?: unknown }).then === "function";
    if (!thenable) return;
    throw new Error(
        "cpuMs() measures synchronous work, and this body returned a promise — the " +
            "clock stopped at its first await, so the reading covers a fraction of the " +
            "work and any budget would pass. Measure the synchronous call, or extend " +
            "this fixture with a measure that samples across the await."
    );
}

/**
 * `process.cpuUsage()` counts the whole process, so it measures only this file's
 * work while this file has a process to itself. Vitest's default `forks` pool
 * gives it one; a `threads` or `vmThreads` pool shares one process between test
 * files, and every sibling worker's CPU then lands in the same counter.
 *
 * **Checked rather than documented, because that failure is silent.** The
 * counter still returns a number under a shared process, so a guard reading a
 * contaminated one reports a pass — the measurement stops being about the
 * pattern and nothing says so.
 *
 * **It rules out the shared-pool case and nothing more.** CPU raised on the
 * libuv threadpool, or by anything else this process is doing, still lands in
 * the counter, and `isMainThread` cannot see that. Both inflate a reading, so
 * they fail a guard rather than pass one — which is why one boolean is the whole
 * check.
 */
function assertOwnProcess(): void {
    if (isMainThread) return;
    throw new Error(
        "cpuMs() needs a worker with a process to itself, and this worker is a thread. " +
            "A `threads`/`vmThreads` pool shares one process between test files, so " +
            "process.cpuUsage() would count sibling workers' CPU as this file's. Drop the " +
            "pool override in vitest.config.ts, or measure these guards another way."
    );
}
