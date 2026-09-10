// src/lib/response/cpu-time.test-fixture.test.ts
import { describe, it, expect } from "vitest";
import { cpuMs } from "./cpu-time.test-fixture.js";

/** Long enough that a wall clock cannot mistake it for jitter, short enough to
 *  cost the suite nothing. Both assertions in the clock case are scaled from it. */
const BLOCK_MS = 50;

/**
 * `cpuMs` is itself a guard, and both of its guards fail closed by throwing —
 * which is exactly the shape a later simplification deletes without turning
 * anything red. These cases are what make that deletion visible.
 *
 * **The pool precondition has no case here, and the absence is deliberate.**
 * `isMainThread` is not injectable, so a unit test could only assert against a
 * stub of the fixture's own import — a test of the mock. It is verified by
 * running the suite under `--pool=threads` instead, where every case that calls
 * `cpuMs` fails with the fixture's message rather than passing on a counter that
 * has silently started including sibling workers. Measured at 29 cases across
 * this file, `strip-blocks.test.ts` and `parser.test.ts`. Re-run that if the
 * check is touched — the count moves whenever a case is added.
 */
describe("cpuMs", () => {
    it("reports the CPU the work actually cost", () => {
        // The positive control, and the reason it comes first: a `cpuMs` that
        // returned 0 unconditionally would satisfy every budget assertion in the
        // suite, so "the guards are green" says nothing until this passes.
        const spin = () => {
            let n = 0;
            for (let i = 0; i < 3_000_000; i++) n += i % 7;
            return n;
        };
        const ms = cpuMs(spin);
        expect(ms).toBeLessThan(60_000);

        // **And anchor the SCALE, not just the sign.** `process.cpuUsage()`
        // reports microseconds and the divisor is 1000; make it 1_000_000 and
        // every reading is 1000x small. `> 0` still passes, `< 60_000` still
        // passes, and so does the wall-clock case below — an under-reporting
        // clock satisfies an upper bound more easily, not less. Measured: with
        // that one character changed, all 131 cases across this file,
        // `strip-blocks.test.ts` and `parser.test.ts` passed, which made every
        // budget in the suite unfailable by any regression under 100 seconds.
        //
        // **An absolute floor, and deliberately not a comparison against wall
        // clock.** 3,000,000 iterations cannot cost under half a millisecond of
        // CPU on any host Node runs on, and this is a LOWER bound on CPU time,
        // so contention pushes the reading up and away from failing. Bounding it
        // below by a `Date.now()` delta would reintroduce the defect this file
        // exists to close: the docblock in `cpu-time.test-fixture.ts` records
        // 6-22 ms of CPU reading as 124-161 ms of wall clock under load, a 7-20x
        // ratio, so any wall-clock ratio tolerance is a false red waiting for a
        // loaded run.
        //
        // **What it does not catch, stated so the claim is not read wider than it
        // is:** an under-report smaller than ~4.8x (the margin between the
        // measured 2.4 ms and this floor), and any OVER-report. Over-reporting
        // makes every budget stricter, so it fails safe. Measured teeth: the
        // `1_000_000` divisor slip reads 0.0025 and the one-order `10_000` slip
        // reads 0.24-0.41 — both below the floor, so both fail deterministically,
        // which a wall-clock ratio did not (it passed 5 of 8 reads on the
        // one-order slip, decided by millisecond rounding).
        expect(ms).toBeGreaterThan(0.5);
    });

    it("reads a clock that ignores time this process did not spend", () => {
        // **The case that separates the two clocks, and the only one that does.**
        // Every other assertion here is satisfied by a wall clock as readily as by
        // `process.cpuUsage()` — a spin costs milliseconds on both — so without
        // this case `cpuMs` can be reverted to `Date.now()` with the whole suite
        // still green, which is the flakiness the fixture exists to have removed.
        //
        // `Atomics.wait` blocks the thread without consuming a core, so it is the
        // one body whose two readings disagree by construction. Synchronous, so it
        // passes the promise check on its way through.
        const blockWithoutSpending = () =>
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
        const started = Date.now();
        const cpu = cpuMs(blockWithoutSpending);
        const wall = Date.now() - started;

        // Measured: ~0.06 ms of CPU against ~55 ms of wall clock. The wall-clock
        // assertion is the control — it proves the body really did block, so a
        // low CPU reading means the clock ignored it rather than that nothing
        // happened.
        //
        // **`>=`, and do not tidy it to `>`.** `Atomics.wait` waits on a monotonic
        // deadline while `Date.now()` truncates, so `floor(t0+50) - floor(t0)` is
        // exactly 50 at the boundary — the margin here is zero by construction and
        // the measurement is one-sided. 140 reps across idle and 48-hog runs: 0
        // failures, minimum exactly 50, median 55. Load is the safe direction,
        // since a deschedule only inflates `wall`.
        expect(wall).toBeGreaterThanOrEqual(BLOCK_MS);
        expect(cpu).toBeLessThan(BLOCK_MS / 2);
    });

    it("measures a body that returns a value, which is what every caller passes", () => {
        // The other direction of the promise check. All live call sites are
        // expression-bodied arrows returning a string, so a check that rejected
        // any return value at all would take the whole suite down with it.
        expect(cpuMs(() => "a string is not a promise")).toBeGreaterThanOrEqual(0);
    });

    it("refuses a body it can only have measured a prefix of", () => {
        // The clock stops when the body returns, so an async body is measured up
        // to its first `await` and the budget passes on microseconds. TypeScript
        // admits this by void-return assignability, so nothing upstream objects.
        expect(() => cpuMs(async () => Promise.resolve("work"))).toThrow(/returned a promise/);
        expect(() => cpuMs(() => ({ then: () => undefined }))).toThrow(/returned a promise/);
    });
});
