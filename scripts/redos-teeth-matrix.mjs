// scripts/redos-teeth-matrix.mjs
//
// **The ReDoS teeth matrix, as a runnable artefact rather than as prose.**
//
// `strip-blocks.test.ts`'s flood tables are guards only if some removable bound in
// `strip-blocks.ts` makes each input expensive. **A hand-re-derived probe cannot be a
// positive control on itself** — `LESSONS.md` RC-60 rule 4 records what that cost here —
// so the claim is computed rather than asserted, and this script is the control.
//
// Runtime is minutes, not seconds — a few cells genuinely cost tens of seconds under the
// mutation they detect, which is the point of them. Not part of `npm test`.
//
//   node scripts/redos-teeth-matrix.mjs            # the matrix, and the accounting
//   node scripts/redos-teeth-matrix.mjs --check    # exit 1 if an asserted property fails
//
// **It asserts four properties. Each is a way the test file can go quietly toothless:**
//
//   1. Every enumerated mechanism has at least one case that detects it. A mechanism with
//      no detector is a bound nothing guards, and nothing else in the suite says so.
//   2. Every case the test file marks `NO TEETH` really has no subset above the budget. A
//      marker is a claim about a mechanism list, so it expires when the list grows, and an
//      expired one invites deleting a live guard.
//   3. The `NO TEETH` marker count in the test file equals the count this matrix computes.
//      A claim of the form *N of M do X* has a one-line verification and rarely gets one.
//   4. Every input measured here is byte-identical to the test file's row of the same label.
//      CASES is a second copy of that table, and a copy that drifts measures a guard nobody
//      runs — the same class as a toothless case, one level up.
//
// **Mechanisms are derived from the subject, and subsets are probed — not singletons.**
// `openers nested inside the bounding closer` costs under 6 ms under either the attribute
// walk or the widened opener class alone and 3.9 s under both, so a singleton matrix cannot
// witness it. When `strip-blocks.ts` gains a bound, add it to MECHANISMS and re-run; the
// annotations in the test file are this script's output, not an independent claim.
//
// It mutates a BUNDLE under the system temp directory. The repository source is never
// written to.

import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// **`fileURLToPath`, never `URL.pathname`.** A URL's pathname is percent-encoded, so a
// checkout under a path containing a space or a `#` yields `/tmp/redos%20matrix/...` and
// every filesystem call here looks for something that does not exist; on Windows it also
// yields `/C:/...`, which is not a native path. `CONVENTIONS.md` → *Language and style*
// names both platforms as supported targets, and `scripts/integration-test.mjs` already
// takes this route.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SRC = join(ROOT, "src/lib/response/strip-blocks.ts");
const TEST = join(ROOT, "src/lib/response/strip-blocks.test.ts");
const CHECK = process.argv.includes("--check");
/** Above this a cell is unambiguously over budget, so one read is enough. */
const REPEAT_BELOW_MS = 400;

/**
 * Each mechanism is a named source transform, with the property it removes.
 *
 * **Every `find` is asserted to match** — exactly once, or at least once where the
 * mechanism sets `all`, because one class is shared by several patterns. An anchor
 * matching nothing would silently measure the UNMUTATED subject and report every case
 * as toothless, which is a green run that proves the opposite of what it claims.
 */
const MECHANISMS = {
    region: {
        what: "withinClosableRegion's region bound, both arms",
        // Three arms, and removing only the slice leaves the bound intact: a body whose
        // `end` is 0 early-returns and the pattern never runs at all, so the case reads
        // as toothless. Both edits are required for the mutation to mean anything.
        edits: [
            ["if (end <= 0) return text;", "if (false) return text;"],
            ["return pass(text.slice(0, end)) + text.slice(end);", "return pass(text);"],
        ],
    },
    noGt: {
        what: "stripTagTokens' noGt latch",
        edits: [["if (noGt) continue;", "if (false) continue;"]],
    },
    noCloser: {
        what: "stripHtmlComments' noCloser latch",
        edits: [["if (noCloser) continue;", "if (false) continue;"]],
    },
    openerClass: {
        what: "the block patterns' OPENING attribute class, [^<>]* widened to [^>]*",
        edits: [
            ["/<script\\b[^<>]*>", "/<script\\b[^>]*>"],
            ["/<style\\b[^<>]*>", "/<style\\b[^>]*>"],
        ],
    },
    walk: {
        what: "lastTagCloserEnd's attribute walk excluding `<`",
        edits: [['text[j] !== ">" && text[j] !== "<"', 'text[j] !== ">"']],
    },
    wordBoundary: {
        what: "lastTagCloserEnd's \\b word-char check",
        edits: [["WORD_CHAR_PATTERN.test(text[j])", "false"]],
    },
    // **The block patterns' CLOSING attribute class is deliberately NOT here.** Widening
    // `[^<>]*` to `[^>]*` on `</script`/`</style` is measurably free: no crossing on any of
    // the 24 cases under any subset, none on six inputs built to target it, and no
    // behavioural difference on four more — the fixed point plus `stripTagTokens` converge
    // to the same output either way, and the whole suite stays green. So it is a defensive
    // symmetry with the opening class rather than a bound, and a cost matrix cannot witness
    // something that costs nothing. It was listed here for two rounds and read as witnessed,
    // because the un-attributed property 1 credited `lastTagCloserEnd`'s walk with its
    // teeth: `walk` alone puts `closer flood with no >` at 7.3 s and `walk+closerClass` at
    // 7.2 s, so the pair crossed on the walk and the closing class got the credit.
    // **Do not re-add it from a reading of `strip-blocks.ts`** — measure it first.
    mdLabel: {
        what: "the markdown label class re-admitting `[`, image AND link",
        edits: [["[^\\]\\[\\n]*", "[^\\]\\n]*"]],
        all: true,
    },
};

// Subsets probed beyond every singleton, each because it is the only one that witnesses
// something. `walk+openerClass` is what makes `openers nested inside the bounding closer`
// regress at all — either mutation alone leaves it under 6 ms. `region+mdLabel` is the only
// subset that witnesses `mdLabel`, which costs nothing while the region bound still
// early-returns on a body with no `)`. Property 1 below is what turns a missing pair into a
// failure rather than into a mechanism silently reported as unguarded.
const PAIRS = [
    ["walk", "openerClass"],
    ["region", "mdLabel"],
];

const CASES = [
    ["comment", "opener flood, no closer", "<!--".repeat(65536)],
    ["comment", "opener flood, one interior closer", "<!--".repeat(4) + "-->" + "<!--".repeat(65531)],
    ["comment", "deep splice flood", "<!".repeat(60000) + "--".repeat(60000)],
    ["block", "<script opener flood, no `>` anywhere", "<script".repeat((256 * 1024) / 7)],
    ["block", "<style opener flood, no `>` anywhere", "<style".repeat((256 * 1024) / 6)],
    ["block", "opener flood behind a leading `>`", ">" + "<script".repeat((256 * 1024) / 7)],
    ["block", "complete <script> openers, no closer", "<script>".repeat(32000)],
    ["block", "complete <style> openers, no closer", "<style>".repeat(32000)],
    ["block", "openers with a foreign closer", "<script></x>".repeat(20000)],
    ["block", "one real block, then an opener flood", "<script>x</script>" + "<script>".repeat(30000)],
    ["block", "closer flood with no `>`", "</script".repeat(30000)],
    ["block", "non-boundary closer name", "<script></scripture>".repeat(13000)],
    ["block", "openers nested inside the bounding closer", "</script " + "<script".repeat(35000) + ">"],
    ["block", "deep script splice", "<scr".repeat(30000) + "<script>" + "ipt>".repeat(30000)],
    ["block", "deep style splice", "<sty".repeat(30000) + "<style>" + "le>".repeat(30000)],
    ["block", "openers borrowing the closer's `>`", "<script".repeat(30000) + "</script>"],
    ["block", "style openers borrowing the closer's `>`", "<style".repeat(30000) + "</style>"],
    ["block", "openers borrowing a whitespace closer's `>`", "<script".repeat(30000) + "</ script>"],
    ["beacon", "`[` flood", "[".repeat(256 * 1024)],
    ["beacon", "`![` flood", "![".repeat((256 * 1024) / 2)],
    ["beacon", "`[](` flood", "[](".repeat((256 * 1024) / 3)],
    ["beacon", "unterminated URL flood", "[a](https://x".repeat(19000)],
    ["beacon", "unterminated URL flood, one trailing `)`", "[a](https://x".repeat(19000) + ")"],
    ["beacon", "unterminated image URL flood", "![a](https://x".repeat(18000)],
];

const ENTRY = { comment: "stripHtmlComments", block: "stripBlocksFixedPoint", beacon: "stripMarkdownBeacons" };

const work = mkdtempSync(join(tmpdir(), "redos-matrix-"));
const fail = [];

// **Bundle the pristine source from its real location first, then mutate the BUNDLE.**
// A mutated copy written to a temp directory cannot resolve `../config/limits.js`, so the
// repository source is bundled where its imports work and every mutation is applied to the
// self-contained output. The anchors in MECHANISMS are therefore bundle-shaped and carry no
// `!` assertions: esbuild strips them, so `text[j]!` in the TypeScript is `text[j]` here.
//
// **esbuild's JS API, not `execFileSync("npx", ...)`.** Node cannot launch a `.cmd` shim
// with `execFile`, and that is what `npx` is on Windows — so the subprocess form failed
// there even after the paths were fixed. The API removes the subprocess, the `npx`
// resolution and the `cwd` argument at once, which is why it is the fix rather than a
// shell flag. `esbuild` is declared in `devDependencies` for this; it was previously
// reached only as a transitive dependency of `tsup` and `vitest`.
const PRISTINE = join(work, "pristine.mjs");
buildSync({ entryPoints: [SRC], bundle: true, format: "esm", platform: "node", outfile: PRISTINE, logLevel: "error" });
const source = readFileSync(PRISTINE, "utf8");

/** Apply a subset of mechanisms, asserting each anchor matched exactly once. */
function mutate(names) {
    let out = source;
    for (const n of names) {
        const m = MECHANISMS[n];
        for (const [find, into] of m.edits) {
            const hits = out.split(find).length - 1;
            // An anchor matching nothing silently measures the UNMUTATED subject and
            // reports every case as toothless — the failure this assertion exists for.
            if (m.all ? hits < 1 : hits !== 1) {
                throw new Error(`mechanism "${n}": anchor ${JSON.stringify(find)} matched ${hits} times (expected ${m.all ? ">=1" : "1"}) — it has moved in strip-blocks.ts`);
            }
            out = m.all ? out.split(find).join(into) : out.replace(find, into);
        }
    }
    return out;
}

function bundle(label, text) {
    const js = join(work, `${label}.mjs`);
    writeFileSync(js, text);
    return js;
}

const cpu = (f) => { const s = process.cpuUsage(); f(); const d = process.cpuUsage(s); return (d.user + d.system) / 1000; };

async function measure(js) {
    const mod = await import(pathToFileURL(js).href);
    const out = [];
    for (const [group, label, body] of CASES) {
        const fn = mod[ENTRY[group]];
        // **Adaptive reads.** Precision matters only near the budget: a cell reading
        // 35 s is above it on any host and a second read costs another 35 s, where a
        // cell reading 90 ms decides an assertion and deserves a median. So read
        // once, and repeat only while the reading is inside the band where the
        // verdict could change.
        const r = [cpu(() => fn(body))];
        if (r[0] < REPEAT_BELOW_MS) { r.push(cpu(() => fn(body)), cpu(() => fn(body))); }
        r.sort((a, b) => a - b);
        out.push({ group, label, ms: r[Math.floor(r.length / 2)] });
    }
    return out;
}

// ---- the budget, DERIVED exactly as the test derives it
//
// **A fixed figure here cannot classify teeth for a test whose budget is a ratio.**
// `strip-blocks.test.ts::REDOS_BUDGET_MS` is `median(a benign cap-sized pass) x ratio`, so
// on a host whose baseline is not ~12.5 ms the two disagree — and properties 2 and 3 below
// compare this script's classification against that file's markers. With a 20 ms baseline
// the tests allow 160 ms, so a 120 ms mutation reads as teeth here while the guard it is
// meant to certify stays green: the reconciliation certifies the wrong answer, which is the
// class `LESSONS.md` RC-60 is about. Same body, same ratio, same denominator.
//
// **The ratio is READ from the test file, not restated here** — one declaration, and a
// change to it cannot leave this script measuring against the old one.
const ratioMatch = /const REDOS_BUDGET_RATIO = (\d+);/.exec(readFileSync(TEST, "utf8"));
if (!ratioMatch) throw new Error("could not read REDOS_BUDGET_RATIO from strip-blocks.test.ts — it has been renamed or reshaped, and this script cannot classify teeth against a budget it cannot find");
const RATIO = Number(ratioMatch[1]);

// The baseline body is pinned rather than parsed: an expression is not safe to evaluate out
// of a file, and asserting the text is what makes a change to it fail loudly here instead of
// silently measuring a different denominator from the test's.
const BASELINE_EXPR = 'const BENIGN_BASELINE_BODY = "a".repeat(STRIP_PATH_MAX_BYTES - 10) + "</script>";';
if (!readFileSync(TEST, "utf8").includes(BASELINE_EXPR)) throw new Error(`strip-blocks.test.ts no longer declares its baseline as ${BASELINE_EXPR} — update BASELINE_EXPR here and the construction below together, or this script derives its budget from a different body than the test does`);

const calib = await import(pathToFileURL(bundle("calibrate", source)).href);
const BENIGN = "a".repeat(calib.STRIP_PATH_MAX_BYTES - 10) + "</script>";
for (let i = 0; i < 3; i++) calib.stripBlocksFixedPoint(BENIGN);
const calibReads = [];
for (let i = 0; i < 9; i++) calibReads.push(cpu(() => calib.stripBlocksFixedPoint(BENIGN)));
calibReads.sort((a, b) => a - b);
const CALIB_MEDIAN = calibReads[4];
if (!(CALIB_MEDIAN > 0)) throw new Error("this host reported 0 ms of CPU for a 256 KB benign pass — its clock is too coarse to calibrate a budget against");
const BUDGET_MS = CALIB_MEDIAN * RATIO;
process.stderr.write(`  budget ${BUDGET_MS.toFixed(1)} ms (baseline ${CALIB_MEDIAN.toFixed(1)} ms x ${RATIO})\n`);

const subsets = [["baseline"], ...Object.keys(MECHANISMS).map((m) => [m]), ...PAIRS];
const results = new Map();

for (const subset of subsets) {
    const label = subset.join("+");
    const text = label === "baseline" ? source : mutate(subset);
    results.set(label, await measure(bundle(label.replace(/\+/g, "_"), text)));
    process.stderr.write(`  measured ${label}\n`);
}

// ---- the matrix
const base = results.get("baseline");
const width = Math.max(...CASES.map(([, l]) => l.length));
const cols = subsets.filter((s) => s[0] !== "baseline").map((s) => s.join("+"));
const fmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : v.toFixed(1));
console.log("\n" + "case".padEnd(width) + "  " + "base".padStart(8) + cols.map((c) => c.slice(0, 13).padStart(15)).join(""));
// **Two different questions, so two lists.** `teeth` answers *does this case have any
// detector* — one entry per case, for the accounting. `crossings` holds EVERY cell above
// budget, because the weakest regression is the tightest side of the budget window and a
// per-row maximum cannot report it: a case whose `noGt` cell sits just over the budget and
// whose `walk` cell costs seconds contributes only the seconds, so the figure that justifies
// the window is taken from the wrong cell and overstates the margin.
const teeth = [];
const crossings = [];
CASES.forEach(([, label], i) => {
    const row = cols.map((c) => results.get(c)[i].ms);
    row.forEach((v, j) => { if (v > BUDGET_MS) crossings.push({ label, by: cols[j], ms: v }); });
    const max = Math.max(...row);
    if (max > BUDGET_MS) teeth.push({ label, by: cols[row.indexOf(max)], ms: max });
    console.log(label.padEnd(width) + "  " + fmt(base[i].ms).padStart(8) + row.map((v) => (v > BUDGET_MS ? `*${fmt(v)}` : fmt(v)).padStart(15)).join(""));
});

// ---- the accounting, computed rather than asserted
const without = CASES.filter(([, l]) => !teeth.some((t) => t.label === l)).map(([, l]) => l);
console.log(`\n=== ACCOUNTING (budget ${BUDGET_MS.toFixed(1)} ms = ${CALIB_MEDIAN.toFixed(1)} x ${RATIO}; * = above it) ===`);
console.log(`${CASES.length} cases — ${teeth.length} with teeth, ${without.length} without`);
console.log(`passing population: ${fmt(Math.min(...base.map((b) => b.ms)))} - ${fmt(Math.max(...base.map((b) => b.ms)))} ms`);
// **`teeth` empty is a state, not an impossibility** — it means no mutation made any case
// expensive, which is the single most important thing this script could ever report. A bare
// `reduce` throws `TypeError` on it, so the run died before properties 1-3 could say so.
const weakest = crossings.length ? crossings.reduce((a, b) => (a.ms < b.ms ? a : b)) : null;
console.log(
    weakest
        ? `weakest regression: ${fmt(weakest.ms)} ms — ${weakest.label} via ${weakest.by} (of ${crossings.length} crossings)`
        : "weakest regression: NONE — no mutation exceeded the budget on any case"
);
console.log(`\nwithout teeth (${without.length}):`);
for (const l of without) console.log(`  - ${l}`);

// ---- property 1: every mechanism has a detector, ATTRIBUTABLE to that mechanism
//
// **A crossing under a subset is not evidence about every mechanism in it.** Counting any
// case over budget would let one mechanism's teeth stand in for another's: `region+mdLabel`
// is over budget on the unterminated-URL cases because `region` alone does that, so deleting
// both `[`-flood detectors would still report `mdLabel` as witnessed — property 1 passing on
// another mutation's teeth, which is the false green it exists to catch.
//
// So require a crossing the mechanism is responsible for: a case above budget WITH it and at
// or below budget WITHOUT it. Every comparator is already measured — a singleton's is the
// baseline, a pair's is the other singleton — so this costs no extra runs.
const subsetWithout = (label, name) => {
    const rest = label.split("+").filter((x) => x !== name);
    return rest.length === 0 ? "baseline" : rest.join("+");
};
console.log("\n=== every mechanism is witnessed by a crossing ATTRIBUTABLE to it ===");
for (const name of Object.keys(MECHANISMS)) {
    const containing = cols.filter((c) => c.split("+").includes(name));
    const attributed = [];
    for (const c of containing) {
        const ref = results.get(subsetWithout(c, name));
        // A subset whose comparator was never measured cannot attribute anything. Skipping it
        // is safe: it can only withhold credit, never grant it.
        if (!ref) continue;
        const n = CASES.filter((_, i) => results.get(c)[i].ms > BUDGET_MS && ref[i].ms <= BUDGET_MS).length;
        if (n > 0) attributed.push(`${c}(${n})`);
    }
    const ok = attributed.length > 0;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(14)} witnessed by ${ok ? attributed.join(", ") : "nothing"}`);
    if (!ok) fail.push(`mechanism "${name}" (${MECHANISMS[name].what}) has no crossing attributable to it — every case above budget in a subset containing it is already above budget without it. Either it is a bound nothing guards, or the subset that would witness it is missing from PAIRS`);
}

// ---- properties 2 and 3: the test file's markers must match this matrix
const marked = [...readFileSync(TEST, "utf8").matchAll(/^\s*\/\/ NO TEETH[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*\["([^"]+)"/gm)].map((m) => m[1]);
console.log("\n=== the test file's NO TEETH markers vs this matrix ===");
console.log(`  markers in strip-blocks.test.ts: ${marked.length}   computed without teeth: ${without.length}`);
if (marked.length !== without.length) fail.push(`marker count ${marked.length} != computed ${without.length}`);
for (const m of marked) if (!without.includes(m)) fail.push(`"${m}" is marked NO TEETH but a subset puts it above the budget`);
for (const w of without) if (!marked.includes(w)) fail.push(`"${w}" has no subset above the budget and is not marked NO TEETH`);

// ---- property 4: this matrix measures the TEST's inputs, in BOTH directions
//
// **The reconciliation above compares labels, so a drifted body passed it unseen.** CASES
// restates each input independently, and one had already drifted: `opener flood, no closer`
// read `repeat(65535)` here against `repeat(65536)` in the test — so the cell reported as
// that guard's teeth was measured on a different string.
//
// Compared as source text rather than by sharing a fixture: the test's table is inside a
// `.test.ts` with vitest imports, so sharing it would mean a new fixture module and a second
// bundle here. Comparing the text costs a regex and turns a silent drift into a named
// failure, which is the property that was missing.
//
// **Whitespace is significant and is NOT normalised away.** `"</ script>"` and `"</script>"`
// are different inputs — one is the whole point of `openers borrowing a whitespace closer's
// \`>\`` — and a normaliser that collapsed whitespace read them as equal, certifying a drift
// on the one case whose distinguishing character is a space. Only the surrounding indentation
// is trimmed. The cost is that a purely cosmetic reformat inside a row reads as drift; that
// direction fails loudly, which is the safe one.
//
// **Both directions, because a one-way check has a silent gap.** Iterating this script's rows
// alone catches a case measured here and absent there, but not a flood case added to the test
// that this matrix never measures — a new guard whose teeth nobody checks, with `--check`
// green. So the test's three `it.each([...])("ReDoS: ...")` tables are read and their labels
// required here too. Scoped to those tables: the file's other `it.each` rows are behavioural
// cases with no timing budget, and demanding a matrix cell for them would be a false failure.
const trimOnly = (t) => t.trim();
const rowsIn = (src, re) => new Map([...src.matchAll(re)].map((m) => [m[1], trimOnly(m[2])]));

// Each `it.each([` is closed by its OWN `])(`, and only then is the title checked. A
// non-greedy match from the first `it.each([` to the first `])("ReDoS:` swallows every
// behavioural table in between and silently reports 33 flood rows where there are 24.
const testSrc = readFileSync(TEST, "utf8");
const floodRows = new Map();
let scan = 0;
let floodTables = 0;
while ((scan = testSrc.indexOf("it.each([", scan)) !== -1) {
    const bodyStart = scan + "it.each([".length;
    const bodyEnd = testSrc.indexOf("])(", bodyStart);
    if (bodyEnd === -1) break;
    if (testSrc.slice(bodyEnd + 3, bodyEnd + 30).startsWith('"ReDoS:')) {
        floodTables++;
        for (const [label, expr] of rowsIn(testSrc.slice(bodyStart, bodyEnd), /^\s*\["([^"]+)",\s*(.+?)\],\s*$/gm)) floodRows.set(label, expr);
    }
    scan = bodyEnd;
}
const selfRows = rowsIn(readFileSync(SELF, "utf8"), /^\s*\["(?:comment|block|beacon)",\s*"([^"]+)",\s*(.+?)\],\s*$/gm);

console.log("\n=== this matrix's inputs vs the test file's ReDoS tables ===");
if (floodTables === 0) fail.push("found no `it.each([...])(\"ReDoS: ...\")` table in strip-blocks.test.ts — the parse has broken, so property 4 is comparing against nothing");
if (selfRows.size !== CASES.length) fail.push(`parsed ${selfRows.size} case rows out of this script's own source but CASES holds ${CASES.length} — the row regex no longer matches the table, so property 4 is not checking anything`);

let matched = 0;
for (const [label, expr] of selfRows) {
    const testExpr = floodRows.get(label);
    if (testExpr === undefined) fail.push(`case "${label}" is measured here but no ReDoS table in strip-blocks.test.ts has that label — the matrix is measuring an input the suite does not guard`);
    else if (testExpr !== expr) fail.push(`case "${label}" has DRIFTED: test has \`${testExpr}\`, this matrix measures \`${expr}\``);
    else matched++;
}
for (const label of floodRows.keys()) {
    if (!selfRows.has(label)) fail.push(`strip-blocks.test.ts guards "${label}" but this matrix never measures it — its teeth are unverified and nothing else would say so`);
}
console.log(`  ${floodTables} ReDoS tables, ${floodRows.size} guarded inputs; ${matched}/${selfRows.size} measured here and identical`);

rmSync(work, { recursive: true, force: true });
if (fail.length) {
    console.error("\n=== ASSERTED PROPERTIES FAILED ===");
    for (const f of fail) console.error(`  - ${f}`);
    if (CHECK) process.exit(1);
} else {
    console.log("\nall asserted properties hold.");
}
