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
 * running the suite under `--pool=threads` instead, where all 25 guards fail
 * with the fixture's message rather than passing on a counter that has silently
 * started including sibling workers. Re-run that if the check is touched.
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
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThan(60_000);
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
