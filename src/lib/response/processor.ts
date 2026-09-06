// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { isJsonContentType } from "./parser.js";
import { saveResponseToFile } from "./file-saver.js";
import {
    IMAGE_REMOVED_PLACEHOLDER,
    LINK_REMOVED_PLACEHOLDER,
    STRIP_PATH_MAX_BYTES,
    looksLikeMarkupShape,
    stripBlocksFixedPoint,
    stripHtmlComments,
    stripMarkdownBeacons,
} from "./strip-blocks.js";
import {
    isMarkdownContentType,
    isRawNumber,
    isSniffableContentType,
    keepNumberLexeme,
    safeHostname,
    supportsMarkupComments,
} from "../utils/index.js";
import { sanitizeAndDetect } from "../security/index.js";

// Re-export types from lib/types for convenience
export type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";
import type { ProcessResponseOptions, ProcessedResponse } from "../types/index.js";

/**
 * Options for {@link defendText}.
 */
export interface DefendTextOptions {
    /** Content-Type of the text, used to select the strip stages. */
    contentType?: string;
    /** Hostname label for injection-detection logging. */
    hostname: string;
    /**
     * True when the content type could not be DETERMINED, as distinct from the
     * origin simply not sending one.
     *
     * Losing our own metadata must never be a way to switch a defence off. When
     * the content type is unknown the strictest grammar applies, so every strip
     * stage runs — the opposite of the permissive default, which let a remote
     * disable beacon stripping by making the metadata unreadable.
     *
     * **Required, not optional, and that is the whole point.** Both fields that
     * select the grammar are absent-able, and absence resolved to the
     * PERMISSIVE arm — so `defendText(text, { hostname })` compiled, looked
     * defended, and ran Step 2 alone. Pass `false` when you know the content
     * type (including knowing the origin sent none), `true` when you could not
     * determine it.
     *
     * **The type is only half the fix, because a type is not a runtime check.**
     * 3.4.0 publishes this function, and a JavaScript consumer can omit the
     * field whatever the declaration says. So omission resolves to the
     * strictest grammar at runtime as well — see the destructuring default in
     * `defendText`. Both halves are needed: the type tells a TypeScript caller
     * to decide, and the default decides safely for a caller who did not.
     */
    contentTypeUndetermined: boolean;
    /**
     * Whether a text that parses as a JSON document is exempt from the markup
     * and markdown strip stages. Defaults true.
     *
     * **The exemption is about the artefact, not the model.** `processResponse`
     * writes post-strip content to disk and `jq_query` reads it back, so
     * rewriting `<script>` or `[a](b)` inside a JSON string value there would
     * silently alter a persisted document. That argument is the whole basis for
     * the exemption — and it does not reach the post-processor wrap, whose
     * channels have no disk artefact: a custom tool's return goes straight to
     * the model. The wrap therefore passes `false`. See `LESSONS.md` RC-10.
     */
    excludeJsonDocuments?: boolean;
    /**
     * Whether to decode numeric HTML entities during the block strip.
     *
     * **Defaults true, and must be false for any channel whose consumer does
     * not itself decode.** The decode is not a scratch copy: its result is what
     * gets returned. On a body bound for a renderer that would decode anyway,
     * that is correct and is what lets Step 5 catch `&#x69;gnore previous
     * instructions`. On a channel like response headers it is additive — it
     * turns inert text the origin sent into live markup we authored.
     */
    decodeEntities?: boolean;
}

/**
 * Every character a JSON document may begin with. RFC 8259 puts any *value* at
 * the top level, so a bare string, number, `true`, `false` or `null` is a whole
 * document — `"![x](https://host/p.gif)"` is one, and jq reads it.
 *
 * **Enumerated because the two-member version was a case set missing its third
 * value.** `{` and `[` cover the documents people picture and omit every scalar,
 * so a scalar document took the strictest grammar, had the beacon inside it
 * rewritten, and was persisted altered — the exact outcome the JSON exemption
 * exists to prevent (RC-10). Reported by coderabbitai on PR #33 round 4.
 *
 * This is only a cheap pre-filter for the parse below; being permissive here
 * costs a `JSON.parse` that fails on its first token, and prose beginning with
 * `t`, `f` or `n` is common enough that the arm is worth having.
 */
const JSON_DOCUMENT_FIRST_CHARS: ReadonlySet<string> = new Set([
    "{", "[", '"', "-",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "t", "f", "n",
]);

/**
 * Whether `text` genuinely parses as JSON.
 *
 * Used only to decide whether an UNDETERMINED content type may skip the
 * markdown/markup strip stages. It must be a parse rather than a shape test:
 * the whole point is to separate a real JSON document (where `<script>` and
 * `[a](b)` are legitimate string content that must survive) from attacker text
 * wearing a `[` at the front. Fails closed — anything that does not parse is
 * treated as not-JSON, which selects the stricter path.
 *
 * **The leading-character test may only ever REJECT what the parse would
 * reject.** It is an optimisation, and every character it turns away is a
 * document class silently losing the exemption — see
 * {@link JSON_DOCUMENT_FIRST_CHARS}.
 *
 * The sibling check in `processResponse`'s jq branch is deliberately NOT this
 * function. It answers a different question — *should I attempt a filter on a
 * body whose content type does not say JSON?* — ahead of an explicit parse that
 * throws either way, so its narrowness changes an error message rather than a
 * strip decision.
 */
function isDefinitelyJson(text: string): boolean {
    return parseJsonDocument(text) !== undefined;
}

/**
 * The parse behind {@link isDefinitelyJson}, returning the value rather than
 * discarding it.
 *
 * Two callers need the same question answered and only one of them needs the
 * answer thrown away, so the parse lives here once. `undefined` means "not a
 * JSON document" — distinguishable from a document whose value IS `null`,
 * which parses fine and comes back wrapped.
 */
function parseJsonDocument(
    text: string,
    preserveNumberLexemes = false
): { value: unknown } | undefined {
    const trimmed = text.trimStart();
    if (trimmed.length === 0) return undefined;
    if (!JSON_DOCUMENT_FIRST_CHARS.has(trimmed[0]!)) return undefined;
    // Cheap gate first: above the strip cap no stage runs either way, so the
    // parse would be pure cost.
    if (Buffer.byteLength(text, "utf8") > STRIP_PATH_MAX_BYTES) return undefined;
    try {
        return {
            value: preserveNumberLexemes ? JSON.parse(text, keepNumberLexeme) : JSON.parse(text),
        };
    } catch {
        return undefined;
    }
}

// `keepNumberLexeme`, `rawJson` and `isRawNumber` live in `utils/json-lexeme.ts`.
// The rule has three callers — this walk, the `jq_filter` branch below, and the
// `jq_query` tool — and it used to have one implementation, so the same body's
// numbers survived inline and were corrupted through jq (RC-27).

// The Node >= 22 capability guard for `JSON.rawJSON` / `JSON.isRawJSON` now lives
// in `utils/json-lexeme.ts`, beside the cast that asserts they exist. It sat here
// while the primitive lived here; once the primitive moved, this was the wrong
// layer — the guard reached `jq_query` only because that tool imports `defendText`
// from the barrel that re-exports this file, so an import path not needing
// `defendText` would have skipped the check silently (RC-29).

/**
 * Run the full defensive pipeline over one piece of remote-origin text.
 *
 * **This is the single defence path for anything returned to the LLM, and it
 * exists as a shared function so that no caller can assemble a shorter one.**
 * It was extracted after `include_headers` split header text out of the body:
 * the header path kept only `sanitizeAndDetect` (Step 2) and silently lost
 * Steps 3-5, so markdown beacons, `<script>`/`<style>` blocks and
 * numeric-entity-masked injections reached the model through the header
 * channel after being stripped from the body for years.
 *
 * The stages, in order, and the order is load-bearing:
 *
 * - **Step 2** — sanitise + detect, ALWAYS, on the ORIGINAL text. Detection
 *   runs before the sanitiser strips anything, so the log signals on what the
 *   attacker actually sent.
 * - **Steps 3-4** — markup comments, the `<script>`/`<style>` strip, and (for
 *   declared markdown) beacon removal. Gated on the strip-path cap so the cost
 *   stays bounded on adversarial input.
 * - **Step 5** — re-sanitise + detect, because the strip path's numeric-entity
 *   decoder unmasks `&#x69;gnore previous instructions` into a real injection
 *   phrase that Step 2 could not see.
 *
 * Callers that need size capping or file-saving want {@link processResponse},
 * which wraps this. Call `defendText` directly only for a text channel that
 * genuinely is not the body — response headers being the one such channel.
 *
 * @param text - Remote-origin text to defend
 * @param options - Content-type (selects strip stages) and hostname (logging)
 * @returns The defended text; never suppressed, only rewritten
 */
export function defendText(text: string, options: DefendTextOptions): string {
    let content = text;
    // Omission resolves to the STRICTEST grammar, not the permissive one. The
    // type makes this field required, which binds TypeScript callers and does
    // nothing at runtime — and 3.4.0 publishes this function, so a JavaScript
    // consumer calling `defendText(text, { hostname })` would otherwise get
    // Step 2 alone and a returned beacon, which is the exact behaviour the
    // required field was added to prevent. Failing closed costs a caller who
    // omits it some over-stripping; failing open costs them the defence.
    const { hostname, contentTypeUndetermined = true } = options;

    // An UNDETERMINED content type selects the strictest grammar rather than
    // the loosest: a remote must not be able to disable a stage by making our
    // metadata unreadable.
    //
    // With ONE exception, and it is not a softening — a body that is plainly
    // JSON is excluded, exactly as a declared `application/json` is. That
    // exclusion exists because `<script>` and `[a](b)` are legitimate inside
    // JSON string values, and `processResponse` writes the POST-strip content
    // to disk: stripping here does not just alter what the model reads, it
    // alters the artefact `jq_query` later reads back, silently. Applying a
    // model-facing posture to persisted bytes is a different decision from
    // applying it to the model, and only the first was ever argued for.
    // The exclusion requires the body to BE JSON, not merely to start like it.
    // A shape test is a bypass: `[![x](https://evil.test)]` begins with `[`, so
    // a leading-character check reads it as JSON, drops the strictest grammar,
    // and — with no declared content type to select the markdown path — lets the
    // beacon through unstripped. Parsing is the only thing that answers the
    // question being asked, so it is what gets asked.
    //
    // Evaluated only where it can change an outcome. Both consumers below are
    // already decided when the caller declares a grammar that neither sniffs
    // nor takes the strictest path — `jq_query` passes `application/json` on
    // every call — and `isDefinitelyJson` is a full parse whose object graph is
    // built and discarded.
    const excludeJsonDocuments = options.excludeJsonDocuments ?? true;
    const jsonExemptionCouldApply =
        excludeJsonDocuments &&
        (contentTypeUndetermined || isSniffableContentType(options.contentType));
    const looksLikeJsonBody = jsonExemptionCouldApply && isDefinitelyJson(content);
    const strictestGrammar = contentTypeUndetermined && !looksLikeJsonBody;

    const isMarkup = strictestGrammar || supportsMarkupComments(options.contentType);
    const isMarkdown = strictestGrammar || isMarkdownContentType(options.contentType);

    // Step 2 — sanitise + detect, ALWAYS for any string body.
    //
    // Earlier revisions gated this on `isText = !isBinaryContentType(CT)` —
    // but the gate was attacker-controllable: setting `Content-Type:
    // image/png` on an HTML body disabled the entire pipeline. The body
    // arriving at `processResponse` is always a string (curl captured
    // stdout as UTF-8, with replacement chars where bytes don't decode);
    // sanitising it can only ever remove attack-class codepoints and
    // collapse padding, both of which are no-ops on legitimate binary
    // previews. Always running sanitise+detect closes the bypass.
    //
    // sanitizeAndDetect runs detection on the **original** input
    // (PR-6b) before the sanitiser strips anything, so injection
    // log signals on whatever the attacker sent — not on the post-
    // strip surface.
    content = sanitizeAndDetect(content, hostname);

    // Outer-level byte cap. `stripBlocksFixedPoint` re-checks the same cap
    // internally, but `stripHtmlComments` (a full scan) and
    // `stripMarkdownBeacons` (five global replaces) are called directly from
    // here and carry no cap of their own.
    // Each is linear — that is invariant 15's job, not this gate's — so what
    // this bounds is the constant: a multi-MB body would otherwise be walked
    // several times over. Gating Steps 3-5 on one check keeps the cap a true
    // upper bound for the whole strip path's cost.
    const exceedsStripCap =
        Buffer.byteLength(content, "utf8") > STRIP_PATH_MAX_BYTES;

    // Content-type sniffing: an attacker controlling the response server
    // can serve HTML body with `Content-Type: text/plain`, `text/csv`,
    // `text/javascript`, `image/png`, `application/octet-stream`, or any
    // unrecognised value to bypass the markup-strip path.
    // `isSniffableContentType` covers any CT that doesn't already declare
    // a structured grammar we'd handle either way (markup/markdown
    // declared) or that we deliberately don't sniff (`application/json`,
    // where `<script>` legitimately appears inside string fields).
    //
    // The sniffer scans the FULL post-sanitise body — bounded by the
    // outer-level `exceedsStripCap` short-circuit so the regex never
    // touches bodies above `STRIP_PATH_MAX_BYTES` (256 KB). Earlier
    // revisions clipped to the first 1 KB; that was itself a bypass
    // (1025+ bytes of preamble + `<script>` past the window).
    const sniffedAsMarkup =
        !exceedsStripCap &&
        !strictestGrammar &&
        !looksLikeJsonBody &&
        isSniffableContentType(options.contentType) &&
        looksLikeMarkupShape(content);
    const needsStripPath = isMarkup || isMarkdown || sniffedAsMarkup;

    // Steps 3-5 — strip + re-sanitise (only when the body needs it AND
    // is below the strip-path cap). The single nested branch keeps the
    // strip-path predicate as one source of truth — Steps 3, 4, and 5
    // share the gate.
    if (needsStripPath && !exceedsStripCap) {
        // A JSON document is never entity-decoded, whatever the origin
        // declared. The decode's output is what gets RETURNED and, through
        // `processResponse`, what gets WRITTEN TO DISK — and `&#x22;` decodes
        // to `"`, which ends a JSON string. Measured: `{"q":"a &#x22;b&#x22;"}`
        // served as `text/html` became `{"q":"a "b"}`, which no longer parses,
        // and `save_to_file` persisted it for `jq_query` to fail on.
        //
        // The sniffed arm already excluded JSON bodies; the DECLARED-markup arm
        // did not, so a single mislabelled Content-Type was enough. Gating the
        // decode here rather than at each caller is what makes the two arms
        // agree. `LESSONS.md` RC-12.
        //
        // `looksLikeJsonBody` is reused when it was already computed; otherwise
        // the parse costs nothing on markup, which fails `isDefinitelyJson`'s
        // leading-character gate immediately.
        const decodeEntities =
            (options.decodeEntities ?? true) &&
            !(looksLikeJsonBody || isDefinitelyJson(content));

        // Step 3 — markup comments + script/style blocks. Fires on any
        // markup-shaped body (declared OR sniffed).
        content = stripHtmlComments(content);
        content = stripBlocksFixedPoint(content, { decodeEntities });

        // Step 4 — markdown beacons. Image / link / dangerous-scheme +
        // residual cleanup. Only fires for declared markdown — sniffed-
        // markup bodies (probably HTML mis-typed as text/plain) don't
        // need the markdown-specific patterns.
        if (isMarkdown) {
            content = stripMarkdownBeacons(content);
        }

        // Step 5 — re-sanitise + detect. The strip path's numeric-entity
        // decoder unmasks `&#x69;gnore previous instructions` into a real
        // injection phrase AFTER the original-text Step 2 detection
        // passed (it saw the entity-encoded form and missed). Using
        // sanitizeAndDetect here (not bare sanitizeResponse) closes the
        // silenced-log gap; per-host throttling (60 s window) prevents
        // double-counting.
        content = sanitizeAndDetect(content, hostname);
    }

    return content;
}

/**
 * The defence every copy that goes INLINE to the model takes.
 *
 * **It exists so the wrap and the size gate cannot disagree about what the
 * model will receive.** The post-processor wrap applies this to every text
 * part; `processResponse` and `executeJqQuery` apply it to the body *before*
 * weighing it, so the gate weighs the bytes that are actually returned. Two
 * callers, one option set, stated here rather than spelled twice.
 *
 * The options and their reasons:
 *
 * - `contentTypeUndetermined: true` — at these boundaries the grammar
 *   genuinely is unknown, so the STRICTEST arm runs and every stage fires.
 * - `excludeJsonDocuments: false` — the JSON exemption is about a persisted
 *   artefact, and nothing inline is persisted. Persisted keeps the exemption;
 *   returned does not (`LESSONS.md` RC-10).
 * - `decodeEntities: false` — the decode's output is what gets returned, so on
 *   a channel whose consumer does not itself decode it would manufacture live
 *   markup from inert bytes (`LESSONS.md` RC-3). Its cost is stated on
 *   `processTextPart` and in ARCHITECTURE.md invariant 1a.
 *
 * **This pass can make text LONGER** — `[link removed]` is 14 bytes and the
 * shortest form it replaces is 9 — which is the whole reason it runs before a
 * size gate rather than after one. `LESSONS.md` RC-15.
 *
 * **A JSON document is defended value by value, never as one string.** The
 * strip stages pair an opening token with a closing one, and a scan over the
 * serialised form pairs them ACROSS the syntax that separates two fields — so
 * `<!--` in one value and `-->` in a later one deleted the intervening key,
 * silently, leaving valid JSON that nothing downstream could tell had been
 * cut. `LESSONS.md` RC-16 and ARCHITECTURE.md invariant 16.
 */
export function defendForInline(text: string, hostname: string): string {
    const parsed = parseJsonDocument(text, true);
    if (parsed === undefined) return defendInlineString(text, hostname);
    // Depth is remote-chosen, so the per-leaf walk is only safe once it is
    // bounded — see {@link MAX_INLINE_DEFENCE_DEPTH}.
    if (exceedsDefenceDepth(parsed.value, MAX_INLINE_DEFENCE_DEPTH)) {
        return defendInlineString(text, hostname);
    }
    return serialiseWithoutGrowing(defendJsonLeaves(parsed.value, hostname), text);
}

/**
 * Re-serialise a defended graph without growing it past its input.
 *
 * **Indented only where indenting does not GROW the document.** The obvious
 * rule — "indent if the input has a newline" — re-inflates a sparsely formatted
 * document by its nesting depth: `{"a":1,\n"b":[1,2,3,4,5,6,7,8,9,10],
 * "c":{"d":{"e":1}}}` measured 53 bytes in and 140 out. Nothing bounds that by a
 * constant, so it would silently break {@link exceedsInlineCap}'s cheap arm and
 * with it invariant 14 — the fix for one invariant reintroducing the violation
 * of another.
 *
 * Comparing against the input instead needs no constant. The compact form can
 * never exceed the input by more than the beacon substitution already accounted
 * for, so whichever branch is taken the growth stays inside
 * {@link MAX_INLINE_GROWTH_RATIO}. Both real producers of pretty JSON here —
 * `formatResponse` and jq, each at two spaces — take the first branch and come
 * back looking as they went in.
 *
 * Shared by {@link defendForInline} and by {@link defendJsonLeaves}'s nested
 * arm, so the growth rule has one implementation rather than one per level.
 */
function serialiseWithoutGrowing(defended: unknown, original: string): string {
    const indented = JSON.stringify(defended, null, 2);
    return Buffer.byteLength(indented, "utf8") <= Buffer.byteLength(original, "utf8")
        ? indented
        : JSON.stringify(defended);
}

/**
 * Depth ceiling for the per-leaf inline defence.
 *
 * **The walk's depth comes from remote bytes, so without this it is the remote
 * that decides whether the defence runs at all.** Measured before the bound
 * existed: a 4,035-byte body of `"[" × 2000` around a markdown beacon overflowed
 * the stack in {@link defendJsonLeaves}, `createWrapper`'s catch logged the
 * `RangeError`, tagged the untouched result as wrapped — so a downstream wrap
 * short-circuited too — and the beacon reached the model verbatim. The byte cap
 * could not bound it: 256 KB of `[` is depth 262,144 against a break near 2,000.
 *
 * 100 matches `extensible/schema-sanitizer.ts::MAX_RECURSION_DEPTH`, which
 * already owns this shape for operator-supplied schemas, and sits far below both
 * observed breaks — the walk's near 2,000 and `JSON.stringify`'s near 20,000.
 * The second of those is why the bound is checked rather than the recursion
 * merely made iterative: re-serialisation recurses inside V8 over the same
 * graph, so an iterative walk alone would move the break rather than remove it.
 *
 * **Over the bound the document takes the undivided scan, which strips rather
 * than throws.** That is a deliberate trade in the safe direction: the defence
 * still runs, so nothing leaks, but a pathologically nested document may lose a
 * field to {@link defendJsonLeaves}'s own reason for existing. Real payloads are
 * nowhere near this — a Lighthouse result nests in the tens.
 */
const MAX_INLINE_DEFENCE_DEPTH = 100;

/**
 * Whether a parsed graph nests deeper than `limit`.
 *
 * **Iterative by construction, with an explicit stack.** A recursive probe would
 * overflow on exactly the input it exists to detect, which is the whole defect
 * {@link MAX_INLINE_DEFENCE_DEPTH} was added for.
 */
function exceedsDefenceDepth(value: unknown, limit: number): boolean {
    const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        if (depth > limit) return true;
        if (isRawNumber(node)) continue;
        if (Array.isArray(node)) {
            for (const item of node) stack.push({ node: item, depth: depth + 1 });
        } else if (node !== null && typeof node === "object") {
            for (const item of Object.values(node)) stack.push({ node: item, depth: depth + 1 });
        }
    }
    return false;
}

/**
 * Whether a value can hold fields, and so can be spliced across them.
 *
 * A {@link keepNumberLexeme} marker is `typeof "object"` with a `rawJSON` key,
 * so it answers this question wrongly unless excluded — and walking into one
 * would defend its lexeme as if it were remote prose, corrupting the very
 * number the marker exists to preserve.
 */
function isCompositeValue(value: unknown): boolean {
    if (isRawNumber(value)) return false;
    return Array.isArray(value) || (value !== null && typeof value === "object");
}

/** {@link defendForInline}'s option set, applied to one undivided string. */
function defendInlineString(text: string, hostname: string): string {
    return defendText(text, {
        hostname,
        contentTypeUndetermined: true,
        excludeJsonDocuments: false,
        decodeEntities: false,
    });
}

/**
 * Defend every string leaf of a parsed JSON value, leaving the structure alone.
 *
 * **Object KEYS are deliberately not defended.** Two keys that defended to the
 * same string would collapse into one, losing a field — which is the very
 * failure this function exists to stop, so the fix must not reintroduce it by
 * another door. A beacon in a key therefore survives to the model; it is a
 * stated residual rather than an oversight.
 *
 * Booleans and `null` are returned untouched. **Numbers keep the origin's own
 * text** via {@link keepNumberLexeme}, which is not a nicety: this docblock used
 * to record the residual as *"re-serialising normalises their spelling (`1.50`
 * becomes `1.5`)"* and treat that as cosmetic. It is the same mechanism as
 * `9223372036854775807` returning `9223372036854776000` and `1e400` returning
 * `null` — `1.50` was simply its most comfortable member. `LESSONS.md` RC-24.
 *
 * Unconditional — this package requires Node ≥22, so there is one numeric
 * behaviour rather than one per host.
 */
function defendJsonLeaves(value: unknown, hostname: string, depth = 0): unknown {
    if (typeof value === "string") {
        // **A string leaf that is ITSELF a composite document gets region-wise
        // treatment too.** RC-16 closed this at the envelope; the property does
        // not travel to the next level by itself. Measured before this arm
        // existed, with `include_metadata: true` over an `application/json`
        // body: `{"a":"open <!--","b":"secret","c":"close -->","d":"kept"}`
        // became `{"a":"open ","d":"kept"}` — the scan paired the opener in `a`
        // with the closer in `c` and deleted `b` between them, leaving valid
        // JSON that nothing downstream could tell had been cut.
        //
        // **Composites only, and that restriction is load-bearing.**
        // {@link JSON_DOCUMENT_FIRST_CHARS} admits digits, `-`, `t`, `f` and
        // `n`, so a scalar leaf parses too — and recursing into one would
        // re-serialise it, rewriting the string `"1.50"` as `"1.5"` and every
        // `"01"` as `"1"`. That corrupts identifiers and version strings for no
        // benefit whatever: a scalar has no fields, so it cannot be spliced
        // across them, and there is nothing here for this arm to fix.
        const budget = MAX_INLINE_DEFENCE_DEPTH - depth;
        const nested = budget > 0 ? parseJsonDocument(value, true) : undefined;
        if (
            nested !== undefined &&
            isCompositeValue(nested.value) &&
            !exceedsDefenceDepth(nested.value, budget)
        ) {
            return serialiseWithoutGrowing(
                defendJsonLeaves(nested.value, hostname, depth + 1),
                value
            );
        }
        return defendInlineString(value, hostname);
    }
    // Before the object arm, which would otherwise walk it: a
    // {@link keepNumberLexeme} marker is an object carrying the number's raw
    // text, and defending that text would corrupt the number it preserves.
    if (isRawNumber(value)) return value;
    if (Array.isArray(value)) {
        return value.map((item) => defendJsonLeaves(item, hostname, depth + 1));
    }
    if (value !== null && typeof value === "object") {
        // **A null-prototype accumulator, because a remote picks these keys.**
        // `JSON.parse` gives `__proto__` an OWN property, but assigning that
        // key to a `{}` literal reaches `Object.prototype`'s inherited setter
        // instead of creating one — so the field never lands and
        // `JSON.stringify` omits it. Measured:
        // `{"__proto__":{"value":"kept"},"ok":2}` came back as `{"ok":2}`,
        // silently, leaving valid JSON. That is this function's own reason for
        // existing arriving by a different door — RC-16 again, with a
        // prototype accessor standing in for the paired marker. `Object.create(null)`
        // has no such accessor to reach, so every key is an own property.
        const defended = Object.create(null) as Record<string, unknown>;
        for (const [key, item] of Object.entries(value)) {
            defended[key] = defendJsonLeaves(item, hostname, depth + 1);
        }
        return defended;
    }
    return value;
}

/**
 * Shortest markdown form {@link defendForInline} can replace with a longer
 * placeholder: `[](file:)`, nine bytes, matched by the dangerous-scheme link
 * pattern. Every other replaced form is longer, and every other stage of the
 * pipeline only deletes — the sanitiser strips attack codepoints and collapses
 * padding, the markup stages remove tags and comments, and the entity decode is
 * off on this path. So the beacon substitution is the ONLY way the defence can
 * add bytes, and this is its worst case.
 *
 * **Pinned by a test rather than asserted here.** A pattern change that admits
 * a shorter form would raise the real ratio while this constant stayed put, and
 * nothing would error.
 */
const SHORTEST_REPLACED_BEACON = "[](file:)".length;

/**
 * Most {@link defendForInline} can multiply a body's length by. Derived from
 * the placeholders themselves so a longer one cannot silently invalidate it.
 */
const MAX_INLINE_GROWTH_RATIO =
    Math.max(IMAGE_REMOVED_PLACEHOLDER.length, LINK_REMOVED_PLACEHOLDER.length) /
    SHORTEST_REPLACED_BEACON;

/**
 * Whether `text` will still exceed `maxBytes` AFTER the defence the model-facing
 * boundary applies to it.
 *
 * **This is the question a size gate has to ask, and asking it of the raw bytes
 * is what invariant 14 was violated by.** `defendForInline` can make text
 * longer, so a body that measures 1000 bytes under a 1000-byte cap can reach the
 * model as 1400 — inside the limit by the gate's reckoning and over it in fact
 * (`LESSONS.md` RC-15).
 *
 * **The defence pass is a measurement here, so it must not be run when it cannot
 * change the answer.** It is not free and it is not side-effect-free: it runs
 * `sanitizeAndDetect`, which logs. Two cheap arms answer first —
 * already-over needs no pass, and growth bounded by
 * {@link MAX_INLINE_GROWTH_RATIO} cannot cross a cap this far away — so the pass
 * runs only for a body within that ratio of the limit. That is also what keeps
 * the detect-on-original trade-off in `processResponse` intact for every body
 * nowhere near its cap.
 *
 * @param hostname - label for the detection log, on the rare arm that runs it
 */
/**
 * **The growth-band double-compute is a known, declined cost — do not "fix" it
 * with the shortcut that looks obvious.**
 *
 * For a body in the growth band that stays inline, this function runs
 * `defendForInline` as a measurement, discards it, and `curl-execute.ts` then
 * runs the identical pass to produce what it returns. Measured at ~4 ms on a
 * 500 KB body under a 600 KB cap. Declined rather than fixed: threading the
 * defended string back out re-creates the two-shapes-of-content hazard that
 * removing `content` from `ProcessedResponse`'s saved arm just eliminated, and
 * 4 ms on a body bounded by `max_result_size` does not buy that back.
 *
 * **The shortcut that is unsound**, recorded so a later round does not spend a
 * measurement rediscovering it: you cannot skip the expensive arm above
 * `STRIP_PATH_MAX_BYTES` on the reasoning that the defence cannot grow a body
 * larger than the strip cap. `defendText` sanitises BEFORE it checks that cap,
 * so a body above it can collapse below it and then take the strip path —
 * measured 263,900 bytes in, 407,401 out, past a 262,144-byte cap. That arm
 * would breach invariant 14 for precisely the body class RC-15 was filed about.
 */
export function exceedsInlineCap(text: string, hostname: string, maxBytes: number): boolean {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) return true;
    if (bytes * MAX_INLINE_GROWTH_RATIO <= maxBytes) return false;
    return Buffer.byteLength(defendForInline(text, hostname), "utf8") > maxBytes;
}

/**
 * The server-authored sentence a saved response comes back as.
 *
 * **Every clause here is a claim an LLM will act on, so each one is gated on
 * something that can answer it.** Two review rounds found two that were not:
 *
 * - **The reader tool is named only where the artefact is in its grammar.**
 *   `jq_query` is the only file-reading tool this server registers, so pointing
 *   at it is the whole route to an over-cap body — but it parses JSON and
 *   returns *"Response is not valid JSON"* on anything else. A 1 MB `text/html`
 *   page was therefore sent to a tool that cannot open it, with no other route
 *   offered. Where the grammar is not JSON the path is still named and the
 *   client's own file tooling is left to it.
 * - **The byte count and the limit claim have to be about the same bytes.**
 *   `exceedsInlineCap` weighs the DEFENDED form, which the defence can make
 *   longer — so a 990-byte body can exceed a 1000-byte cap. Reporting
 *   *"990 bytes exceeded the 1000-byte limit"* is a sentence no reader can
 *   reconcile, and a model that responds by raising `max_result_size` to 1200
 *   gets the same file back. The size is labelled as the on-disk size and the
 *   limit is labelled as applying after the pass, so both are true together.
 *
 * `save_to_file` is a request rather than a limit, which is why the over-cap
 * clause is absent on that arm entirely: telling the model it exceeded a limit
 * it did not exceed is a falsehood about its own request.
 */
function savedMessage(
    diskBytes: number,
    filepath: string,
    maxSize: number,
    overCap: boolean,
    contentType: string | undefined
): string {
    const cause = overCap
        ? `Response (${diskBytes} bytes on disk) was saved to: ${filepath} — it exceeds the ` +
          `${maxSize}-byte inline limit once the inline defence pass is applied, so no body is ` +
          `returned here.`
        : `Response (${diskBytes} bytes) saved to: ${filepath}`;

    const route = isJsonContentType(contentType)
        ? " Use the jq_query tool on that path to extract fields."
        : ` The body is ${contentType ? `\`${contentType}\`` : "not JSON"}, which the jq_query ` +
          `tool cannot parse — read the path with your own file tooling.`;

    return cause + route;
}

/**
 * Process response with filtering and size handling.
 *
 * Processing pipeline (text content only):
 * 1. Early size guard (against {@link LIMITS.MAX_RESPONSE_SIZE}).
 * 2. **Sanitise + detect** (Unicode attack chars stripped; visible-space
 *    + newline padding collapsed; injection patterns logged on the
 *    pre-sanitise text per the PR-6b ordering). Runs FIRST so that
 *    the strip path's 256 KB cap can't be evaded by Unicode-padding
 *    inflation: an attacker can't pad with U+200B to push the body above
 *    the cap because sanitiser collapses padding before the strip path
 *    is gated on byte-length.
 * 3. **Strip HTML comments + script/style blocks** (markup content types,
 *    markdown content types, OR plain-text-shaped responses whose body
 *    sniffs as markup — closes the `Content-Type: text/plain` tampering
 *    bypass where an attacker serves HTML with the wrong header). The
 *    strip path is ReDoS-hardened by construction rather than by the byte
 *    cap: every pass runs only over the prefix ending at its own closing
 *    token (ARCHITECTURE.md invariant 15). Balanced blocks go by lazy
 *    match; every remaining tag or comment TOKEN goes by a left-to-right
 *    scan testing the output tail, so a self-healing payload converges
 *    without iterating and a malformed or unclosed closer loses its tag
 *    without its body. The fixed-point loop that remains bounds the
 *    numeric-entity decode, which unmasks `&#x3c;script&#x3e;` smuggling.
 * 4. **Strip markdown beacons** (image / link / dangerous-scheme +
 *    residual cleanup for nested image-inside-dangerous-link cases).
 * 5. **Re-sanitise + detect** post-strip (`sanitizeAndDetect`, NOT plain
 *    sanitiseResponse). The strip path's numeric-entity decoder unmasks
 *    `&#x69;gnore previous instructions` into a real injection phrase
 *    that the original-text Step 2 detection couldn't see (it saw the
 *    entity-encoded form). The re-detection here closes the silenced-
 *    log gap; throttling prevents same-hostname noise.
 * 6. Apply jq_filter if provided AND response is JSON. Re-sanitise after
 *    filter (JSON.parse may decode escapes into real attack chars).
 * 7. Check size against `maxResultSize`; auto-save to file if exceeded.
 *    NOTE: post-pipeline byte length is NOT guaranteed monotone-shrinking
 *    — markdown beacon replacement substitutes `[link removed]` (14
 *    bytes) which can be longer than a minimal source like `[a](http://x)`.
 *    The post-pipeline size check is therefore required, not redundant.
 *
 * @param response - Response content to process; runtime-checked to be a
 *                   string (the type system enforces this for TS callers,
 *                   but JS callers from custom-tool hooks could bypass).
 * @param options - Processing options (url, jqFilter, maxResultSize, etc.)
 * @returns ProcessedResponse with content and file save status
 * @throws TypeError if `response` is not a string
 * @throws Error if response exceeds the absolute size cap or jq_filter
 *   is used on non-JSON content
 */
export async function processResponse(
    response: string,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    if (typeof response !== "string") {
        throw new TypeError("processResponse: response must be a string");
    }

    // Step 1: Early size guard — runs BEFORE sanitization to avoid wasting CPU on oversized responses
    const rawBytes = Buffer.byteLength(response, "utf8");
    if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
        );
    }

    // Resolve hostname once for injection-detection logging; the defence
    // pipeline and the post-jq re-sanitise below both label with it.
    const hostname = safeHostname(options.url);

    // Steps 2-5 — the shared defence pipeline. Extracted so the header
    // channel takes the identical path; see `defendText`.
    let content = defendText(response, {
        contentType: options.contentType,
        contentTypeUndetermined: options.contentTypeUndetermined ?? false,
        hostname,
    });

    // Step 6: Apply jq filter if provided AND response is JSON
    if (options.jqFilter) {
        const isJson = isJsonContentType(options.contentType);
        const trimmed = content.trim();

        // Parse JSON once and reuse for both validation and filtering
        let parsedData: unknown;
        if (!isJson) {
            // Check if it looks like JSON despite content-type (some APIs don't set correct headers)
            const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (!looksLikeJson) {
                throw new Error(
                    `Cannot apply jq_filter: Response is not JSON (Content-Type: ${options.contentType || "unknown"})`
                );
            }
        }

        try {
            // Same reviver as the defence walk above and as `jq_query`: this
            // branch re-serialises through `applyJqFilterToParsed`, so without
            // it a 64-bit id returned by `curl_execute` with a `jq_filter` is
            // silently rounded while the SAME body returned without one is
            // exact (RC-27).
            parsedData = JSON.parse(trimmed, keepNumberLexeme);
        } catch (error) {
            // SyntaxError indicates invalid JSON
            if (error instanceof SyntaxError) {
                throw new Error(
                    `Cannot apply jq_filter: Response does not appear to be valid JSON`
                );
            }
            throw error; // Re-throw unexpected errors
        }

        // Apply filter to pre-parsed data (avoids double parse)
        content = applyJqFilterToParsed(parsedData, options.jqFilter);

        // Re-sanitize and re-detect after filter: JSON.parse decodes Unicode escapes in string
        // values (e.g. {"cmd":"Ig​nore..."} → zero-width space in jq output), so attack
        // chars that were invisible in the raw text become real characters in the filtered result.
        //
        // Runs UNCONDITIONALLY — the previous `if (isText)` gate let an
        // attacker bypass post-jq sanitisation by labelling JSON as
        // `application/octet-stream` (binary). If we got this far jq
        // produced a textual filter result; binary-labelled-but-actually-
        // JSON bodies must be sanitised on output.
        content = sanitizeAndDetect(content, hostname);
    }

    // Step 7: Determine max size and decide save-to-file.
    //
    // **The gate weighs the DEFENDED bytes and returns the undefended ones, and
    // the asymmetry is the point.** Downstream of here the post-processor wrap
    // applies `defendForInline` to whatever goes inline, and that pass can make
    // text longer — `[link removed]` is 14 bytes and the shortest form it
    // replaces is 9. Measuring `content` would therefore report a size the
    // model never receives and let an over-cap result stay inline, which is the
    // invariant-14 violation this closes (`LESSONS.md` RC-15).
    //
    // What it does NOT do is rewrite the returned value. `processResponse` has
    // one caller (`tools/curl-execute.ts`) and is exported from none of the four
    // npm entry points, but its documented behaviour is still the ORIGIN's
    // grammar — a `text/plain` body keeps its comments, a JSON document keeps
    // `<script>` inside its string values (RC-10) — and the strict pass belongs
    // to the model-facing boundary, not to this one. So the defended text is
    // computed as a measurement and discarded; only the gate consumes it, and on
    // the over-cap arm below it is not computed at all.
    //
    // **This is also why the cap cannot be enforced at the wrap itself**, which
    // was the other candidate. By then the body is sealed inside
    // `formatResponse`'s JSON envelope, so there is no discrete body left to
    // bound, a byte-truncation would cut the envelope mid-JSON, and the wrap has
    // no file to save to. Measured: a compliant 1000-byte body arrives at the
    // wrap as a 1057-byte text part under `include_metadata`, so a wrap-side cap
    // would truncate correct responses.
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    const overCap = exceedsInlineCap(content, hostname, maxSize);

    const shouldSave = options.saveToFile || overCap;

    if (shouldSave) {
        const filepath = await saveResponseToFile(content, options.url, options.outputDir);
        // **No body bytes are returned on this arm, and that is the whole
        // saving.** This used to return a preview — `defendForInline` over the
        // entire body, then a byte-cut to `maxSize` — on the reasoning that the
        // defended form was the only one that could be bounded. The reasoning
        // was sound and the consumer was not there: `formatResponse`'s file
        // branch emits `saved_to_file`, `filepath` and `message` and never reads
        // the body, so the pass produced nothing the model ever saw. Measured at
        // 91 ms of a 197 ms call on a 9.4 MB body (`docs/todos/008`).
        //
        // Dropping it makes invariant 14 trivially true here rather than
        // narrowly true: the cap cannot be exceeded by bytes that are not
        // returned. `ProcessedResponse`'s saved arm carries no `content` field
        // at all, so this is enforced by the type and not by this comment.
        //
        // The body is not lost — it is on disk in origin grammar, and `message`
        // below names the tool that reads it.
        return {
            savedToFile: true,
            filepath,
            message: savedMessage(
                Buffer.byteLength(content, "utf8"),
                filepath,
                maxSize,
                overCap,
                options.contentType
            ),
        };
    }

    return {
        content,
        savedToFile: false,
    };
}
