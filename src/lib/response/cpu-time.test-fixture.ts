// src/lib/response/cpu-time.test-fixture.ts
import { isMainThread } from "node:worker_threads";

/**
 * CPU milliseconds consumed by `work` — the quantity the invariant-15 timing
 * guards are about.
 *
 * **Wall clock is not a proxy for it.** `Date.now()` keeps counting while the
 * worker is descheduled, so beside the suite's own parallel workers it measures
 * the host's load rather than the pattern's cost. A budget of 100 ms against
 * 1-2 ms of work read 124-161 ms and failed. No margin closes that: a
 * descheduled measurement is unbounded however wide the budget is, which is why
 * the answer is a different clock rather than a larger number.
 */
export function cpuMs(work: () => void): number {
    assertOwnProcess();
    const started = process.cpuUsage();
    work();
    const spent = process.cpuUsage(started);
    return (spent.user + spent.system) / 1000;
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
