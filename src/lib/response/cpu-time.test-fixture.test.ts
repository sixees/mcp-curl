// src/lib/response/cpu-time.test-fixture.test.ts
import { describe, it, expect } from "vitest";
import { cpuMs } from "./cpu-time.test-fixture.js";

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
/** Long enough that a wall clock cannot mistake it for jitter, short enough to
 *  cost the suite nothing. Both assertions in the clock case are scaled from it. */
const BLOCK_MS = 50;

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
        const startedAt = Date.now();
        const ms = cpuMs(spin);
        const wall = Date.now() - startedAt;
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThan(60_000);

        // **And anchor the SCALE, not just the sign.** `process.cpuUsage()`
        // reports microseconds and the divisor is 1000; make it 1_000_000 and
        // every reading is 1000x small. `> 0` still passes, `< 60_000` still
        // passes, and so does the wall-clock case below — an under-reporting
        // clock satisfies an upper bound more easily, not less. Measured: with
        // that one character changed, all 131 cases across this file,
        // `strip-blocks.test.ts` and `parser.test.ts` pass, which makes every
        // budget in the suite unfailable by any regression under 100 seconds.
        //
        // A busy spin burns wall clock and CPU at roughly 1:1, so the two agree
        // within an order of magnitude. The band is deliberately an order wide —
        // it is a unit check, not a timing assertion, so contention cannot flake
        // it — and no constant-factor error survives it.
        expect(ms).toBeGreaterThan(wall / 10);
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
