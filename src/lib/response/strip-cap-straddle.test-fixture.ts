// src/lib/response/strip-cap-straddle.test-fixture.ts
//
// **`.test-fixture.ts`, not `.ts`, and the suffix is the boundary.** Nothing in
// production may import this file; `file-saver.test.ts`'s *nothing in
// production imports a test-only module* sweep is what enforces it.
// `CONVENTIONS.md` → *Naming* owns the rule.
//
// One input, shared by the unit guard in `defend-text.test.ts` and the
// end-to-end guard in `tools/register-all-tools.test.ts`. Its whole value is a
// size relation, so two hand-built copies with their own preconditions let a
// change to the cap or the collapse rule empty one guard while the other is
// resized to pass. `LESSONS.md` RC-32.
import { STRIP_PATH_MAX_BYTES } from "./strip-blocks.js";
import { sanitizeResponse } from "../utils/index.js";

const run = " ".repeat(200); // >= 50 chars, so Step 2 collapses each to one
const filler = Array.from({ length: 1600 }, (_, i) => `f${i}${run}`).join("");

/**
 * A JSON document above `STRIP_PATH_MAX_BYTES` as the origin sends it and far
 * below it once Step 2 collapses the padding, with a comment opener in one field
 * and its closer in a later one.
 *
 * Any JSON decision keyed on the raw byte count declines it while the strip cap,
 * measured after Step 2, admits it — and the undivided strip then deletes
 * `secret` along with the markers.
 */
export const STRADDLE_BODY = JSON.stringify({
    a: "open <!--",
    secret: "SENTINEL",
    c: "close -->",
    d: "kept",
    filler,
});

/** The top-level keys a defence that deletes nothing leaves in place. */
export const STRADDLE_KEYS = ["a", "secret", "c", "d", "filler"];

/**
 * Throw unless {@link STRADDLE_BODY} still crosses the strip cap only before
 * sanitising.
 *
 * Measured with the real constant and the real sanitiser, so a moved cap or a
 * changed collapse rule fails every suite that calls this rather than leaving a
 * guard passing against input that no longer reaches the window.
 */
export function assertStraddlesStripCap(): void {
    const raw = Buffer.byteLength(STRADDLE_BODY, "utf8");
    const sanitised = Buffer.byteLength(sanitizeResponse(STRADDLE_BODY), "utf8");
    if (raw <= STRIP_PATH_MAX_BYTES || sanitised >= STRIP_PATH_MAX_BYTES) {
        throw new Error(
            `straddle fixture no longer crosses the strip cap (${STRIP_PATH_MAX_BYTES}): ` +
                `${raw} bytes raw, ${sanitised} sanitised`
        );
    }
}
