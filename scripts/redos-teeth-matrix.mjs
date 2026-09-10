// scripts/redos-teeth-matrix.mjs
//
// **The ReDoS teeth matrix, as a runnable artefact rather than as prose.**
//
// `strip-blocks.test.ts`'s flood tables are guards only if some removable bound in
// `strip-blocks.ts` makes each input expensive. That claim was re-derived by hand in three
// consecutive review rounds and was wrong every time — seven cases without teeth, then six,
// then five, then four — because a hand-re-derived probe cannot be a positive control on
// itself (`LESSONS.md` RC-60, rule 4). This script is the control.
//
// Runtime is minutes, not seconds — a few cells genuinely cost tens of seconds under the
// mutation they detect, which is the point of them. Not part of `npm test`.
//
//   node scripts/redos-teeth-matrix.mjs            # the matrix, and the accounting
//   node scripts/redos-teeth-matrix.mjs --check    # exit 1 if an asserted property fails
//
// **It asserts three properties, and each has been false at some point:**
//
//   1. Every enumerated mechanism has at least one case that detects it. A mechanism with no
//      detector is a bound nothing guards — that was true of `lastTagCloserEnd`'s attribute
//      walk for two releases.
//   2. Every case the test file marks `NO TEETH` really has no subset above the budget. That
//      was false for `closer flood with no >` and for `openers nested inside the bounding
//      closer`, the second only under a PAIR.
//   3. The `NO TEETH` marker count in the test file equals the count this matrix computes.
//      The prose said seven against six markers, and nobody ran `rg -c`.
//
// **Mechanisms are derived from the subject, and subsets are probed — not singletons.** Case
// 10 costs under 6 ms under either the attribute walk or the widened opener class alone and
// 3.9 s under both, so a singleton matrix cannot witness it. When `strip-blocks.ts` gains a
// bound, add it to MECHANISMS and re-run; the annotations in the test file are this script's
// output, not an independent claim.
//
// It mutates a BUNDLE under the system temp directory. The repository source is never
// written to.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/lib/response/strip-blocks.ts", import.meta.url).pathname;
const TEST = new URL("../src/lib/response/strip-blocks.test.ts", import.meta.url).pathname;
const BUDGET_MS = 100;
const K = 256 * 1024;
const CHECK = process.argv.includes("--check");
/** Above this a cell is unambiguously over budget, so one read is enough. */
const REPEAT_BELOW_MS = 400;

/**
 * Each mechanism is a named source transform, with the property it removes.
 * `find` must appear exactly once in the source — a transform that matches nothing
 * silently measures the unmutated subject and reports every case as toothless.
 */
const MECHANISMS = {
    region: {
        what: "withinClosableRegion's region bound, both arms",
        // Three arms, and removing only the slice leaves the bound intact: a body whose
        // `end` is 0 early-returns and the pattern never runs at all, so the case reads
        // as toothless. The first version of this script made exactly that mistake.
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
    closerClass: {
        what: "the block patterns' CLOSING attribute class, [^<>]* widened to [^>]*",
        edits: [
            ["<\\/\\s*script\\b[^<>]*>/gi", "<\\/\\s*script\\b[^>]*>/gi"],
            ["<\\/\\s*style\\b[^<>]*>/gi", "<\\/\\s*style\\b[^>]*>/gi"],
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
    mdLabel: {
        what: "the markdown label class re-admitting `[`, image AND link",
        edits: [["[^\\]\\[\\n]*", "[^\\]\\n]*"]],
        all: true,
    },
};

/** Subsets probed, beyond every singleton. A pair is here because a case needed it. */
const PAIRS = [
    ["walk", "openerClass"],
    ["walk", "closerClass"],
    ["region", "mdLabel"],
];

const CASES = [
    ["comment", "opener flood, no closer", "<!--".repeat(65535)],
    ["comment", "opener flood, one interior closer", "<!--".repeat(4) + "-->" + "<!--".repeat(65531)],
    ["comment", "deep splice flood", "<!".repeat(60000) + "--".repeat(60000)],
    ["block", "<script opener flood, no `>` anywhere", "<script".repeat(K / 7)],
    ["block", "<style opener flood, no `>` anywhere", "<style".repeat(K / 6)],
    ["block", "opener flood behind a leading `>`", ">" + "<script".repeat(K / 7)],
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
    ["beacon", "`[` flood", "[".repeat(K)],
    ["beacon", "`![` flood", "![".repeat(K / 2)],
    ["beacon", "`[](` flood", "[](".repeat(K / 3)],
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
// self-contained output. Anchors below are therefore bundle-shaped — no `!` assertions.
const PRISTINE = join(work, "pristine.mjs");
execFileSync("npx", ["esbuild", SRC, "--bundle", "--format=esm", "--platform=node", `--outfile=${PRISTINE}`, "--log-level=error"], { cwd: new URL("..", import.meta.url).pathname });
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
const teeth = [];
CASES.forEach(([, label], i) => {
    const row = cols.map((c) => results.get(c)[i].ms);
    const max = Math.max(...row);
    if (max > BUDGET_MS) teeth.push({ label, by: cols[row.indexOf(max)], ms: max });
    console.log(label.padEnd(width) + "  " + fmt(base[i].ms).padStart(8) + row.map((v) => (v > BUDGET_MS ? `*${fmt(v)}` : fmt(v)).padStart(15)).join(""));
});

// ---- the accounting, computed rather than asserted
const without = CASES.filter(([, l]) => !teeth.some((t) => t.label === l)).map(([, l]) => l);
console.log(`\n=== ACCOUNTING (budget ${BUDGET_MS} ms; * = above it) ===`);
console.log(`${CASES.length} cases — ${teeth.length} with teeth, ${without.length} without`);
console.log(`passing population: ${fmt(Math.min(...base.map((b) => b.ms)))} - ${fmt(Math.max(...base.map((b) => b.ms)))} ms`);
const weakest = teeth.reduce((a, b) => (a.ms < b.ms ? a : b));
console.log(`weakest regression: ${fmt(weakest.ms)} ms — ${weakest.label} via ${weakest.by}`);
console.log(`\nwithout teeth (${without.length}):`);
for (const l of without) console.log(`  - ${l}`);

// ---- property 1: every mechanism has a detector
// A mechanism counts as witnessed if ANY probed subset containing it has a detector.
// Some bounds only fail in combination — the markdown label class needs the region bound
// broken too — so requiring a singleton detector would report a guarded bound as unguarded.
console.log("\n=== every mechanism is witnessed by some subset ===");
for (const name of Object.keys(MECHANISMS)) {
    const containing = cols.filter((c) => c.split("+").includes(name));
    const best = containing.map((c) => ({ c, n: CASES.filter((_, i) => results.get(c)[i].ms > BUDGET_MS).length })).filter((x) => x.n > 0);
    const ok = best.length > 0;
    const via = ok ? best.map((b) => `${b.c}(${b.n})`).join(", ") : "nothing";
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(14)} witnessed by ${via}`);
    if (!ok) fail.push(`mechanism "${name}" (${MECHANISMS[name].what}) is witnessed by no probed subset — either it is a bound nothing guards, or a subset is missing from PAIRS`);
}

// ---- properties 2 and 3: the test file's markers must match this matrix
const marked = [...readFileSync(TEST, "utf8").matchAll(/^\s*\/\/ NO TEETH[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*\["([^"]+)"/gm)].map((m) => m[1]);
console.log("\n=== the test file's NO TEETH markers vs this matrix ===");
console.log(`  markers in strip-blocks.test.ts: ${marked.length}   computed without teeth: ${without.length}`);
if (marked.length !== without.length) fail.push(`marker count ${marked.length} != computed ${without.length}`);
for (const m of marked) if (!without.includes(m)) fail.push(`"${m}" is marked NO TEETH but a subset puts it above the budget`);
for (const w of without) if (!marked.includes(w)) fail.push(`"${w}" has no subset above the budget and is not marked NO TEETH`);

rmSync(work, { recursive: true, force: true });
if (fail.length) {
    console.error("\n=== ASSERTED PROPERTIES FAILED ===");
    for (const f of fail) console.error(`  - ${f}`);
    if (CHECK) process.exit(1);
} else {
    console.log("\nall asserted properties hold.");
}
