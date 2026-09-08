// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
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
 *
 * **Not the body gate either — see {@link classifyBody}, which owns that and
 * explains why this predicate cannot do the job.** The short version is the
 * strip cap below: above {@link STRIP_PATH_MAX_BYTES} this answers "not JSON"
 * as a cost optimisation, which is correct for selecting a strip exemption no
 * stage would run anyway, and wrong for any decision taken on bodies that are
 * over the inline cap by construction.
 */
function isDefinitelyJson(text: string): boolean {
    const trimmed = text.trimStart();
    if (trimmed.length === 0) return false;
    if (!JSON_DOCUMENT_FIRST_CHARS.has(trimmed[0]!)) return false;
    // Cheap gate first: above the strip cap no stage runs either way, so the
    // parse would be pure cost.
    if (Buffer.byteLength(text, "utf8") > STRIP_PATH_MAX_BYTES) return false;
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Why a body is not a JSON document this server will return verbatim.
 *
 * **A closed vocabulary this repository owns, carrying zero remote bytes by
 * construction** — per `.claude/rules/04-no-instance-literals.md`, and per
 * `docs/todos/018`, which measured what the alternative costs. V8's own
 * `SyntaxError.message` embeds up to ten bytes of the body verbatim, and the
 * WHOLE body when the body is short: `JSON.parse('{"a": SUPERSECRET}')` reports
 * ``Unexpected token 'S', "{"a": SUPERSECRET}" is not valid JSON``. So the
 * message is a remote-authored channel and is never interpolated anywhere —
 * not into a response, not into a log line a `verbose` transcript could carry.
 *
 * Every member is decided from a fact this process establishes itself:
 *
 * - `empty-body` — the body is empty or whitespace only.
 * - `looks-like-markup` — the first non-space byte is `<`. Decided before the
 *   parse, and sound to decide there because {@link JSON_DOCUMENT_FIRST_CHARS}
 *   does not admit `<`, so such a body can never parse. This is the member that
 *   answers *"HTML error page, or truncated body?"* — the question
 *   `docs/todos/018` requires the report to answer — without echoing a byte.
 * - `bare-scalar` — parses, but the value is not an object or an array. `null`,
 *   `42` and `"<script>x</script>"` all land here.
 * - `invalid-syntax` — the parse threw and none of the above applies.
 *
 * Why a body was not handed back as JSON.
 *
 * A closed vocabulary this repo owns, so no response byte can reach the message
 * that reports it — V8's parse error embeds up to ten bytes of the body, and the
 * whole body when it is short, so its text is never interpolated.
 */
export type JsonRejectionReason = "empty-body" | "looks-like-markup" | "invalid-syntax";

/**
 * What the body path decided about a response body.
 *
 * `json: true` is the only arm whose bytes are returned to the model and
 * persisted as the origin sent them.
 */
export type BodyClassification =
    | { readonly json: true }
    | { readonly json: false; readonly reason: JsonRejectionReason };

/**
 * **The gate: parse to validate, never to transform.**
 *
 * One rule for the body and for the artefact, because they ask the same
 * question — *may these bytes be handed over as they are?* A successful parse is
 * the whole test, scalars included: `null` from a "no record" endpoint is JSON
 * and comes back as `null`. The parsed value is discarded; only the original
 * text is ever returned.
 *
 * Deliberately NOT {@link isDefinitelyJson}, which skips the parse above
 * {@link STRIP_PATH_MAX_BYTES} (262,144) while the inline cap is 500,000 — so on
 * the band where the artefact question actually arises, that predicate always
 * answers no.
 */
export function classifyBody(text: string): BodyClassification {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { json: false, reason: "empty-body" };
    // Cheap pre-parse exit: `<` is not a JSON first character, so an HTML error
    // page is rejected without parsing megabytes to learn it.
    if (trimmed.startsWith("<")) return { json: false, reason: "looks-like-markup" };
    try {
        // No reviver: the value is discarded, so preserving number lexemes would
        // buy nothing. This gate's question is about syntax alone.
        JSON.parse(text);
    } catch {
        return { json: false, reason: "invalid-syntax" };
    }
    return { json: true };
}

// `keepNumberLexeme`, `rawJson` and `isRawNumber` live in `utils/json-lexeme.ts`,
// with the Node >= 22 capability guard for `JSON.rawJSON` beside them. The guard
// belongs there rather than here: an import path reaching `jq_query` without
// going through `defendText`'s barrel would skip it silently. The lexeme rule
// must stay a single implementation — a second copy is how a body's numbers end
// up corrupted through jq while surviving intact inline. `LESSONS.md` RC-27,
// RC-29.

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

    // An UNDETERMINED content type selects the strictest grammar, not the
    // loosest: a remote must not disable a stage by making our metadata
    // unreadable. One exception — a body that is plainly JSON is excluded, as a
    // declared `application/json` is, because `<script>` and `[a](b)` are
    // legitimate inside JSON string values and a caller may be persisting what
    // it defends.
    //
    // **The exclusion requires the body to BE JSON, not to start like it.**
    // `[![x](https://evil.test)]` begins with `[`, so a leading-character check
    // reads it as JSON, drops the strictest grammar and lets the beacon through.
    //
    // **Step 2 runs BEFORE the grammar is selected.** Every decision below reads
    // `content` and sanitising changes it, so computing them first left three
    // consumers acting on an observation that was true when taken and false when
    // used — one zero-width space was enough to lose the exemption and splice two
    // fields out of a document on its only copy. The same order makes
    // `isDefinitelyJson`'s byte gate measure the same bytes as `exceedsStripCap`.
    // Detection is unaffected: it reads `sanitizeAndDetect`'s input, which is the
    // original text at either position. `LESSONS.md` RC-16, RC-31, RC-32.
    // Step 2 — sanitise + detect, ALWAYS, whatever the body declares.
    //
    // Gating this on content type would be attacker-controllable: `Content-Type:
    // image/png` on an HTML body would disable the whole pipeline. The body here
    // is always a string, and sanitising it can only remove attack-class
    // codepoints and collapse padding — both no-ops on a legitimate binary
    // preview. Detection runs on this function's INPUT, before the sanitiser
    // strips anything, so the log signals on what the origin actually sent.
    content = sanitizeAndDetect(content, hostname);

    const excludeJsonDocuments = options.excludeJsonDocuments ?? true;
    const jsonExemptionCouldApply =
        excludeJsonDocuments &&
        (contentTypeUndetermined || isSniffableContentType(options.contentType));
    const looksLikeJsonBody = jsonExemptionCouldApply && isDefinitelyJson(content);

    // Losing our own metadata must never be a way to switch a stage off, so an
    // undetermined OR absent type takes every stage a declared markup type would.
    const strictestGrammar =
        (contentTypeUndetermined || options.contentType === undefined) && !looksLikeJsonBody;

    const isMarkup = strictestGrammar || supportsMarkupComments(options.contentType);
    const isMarkdown = strictestGrammar || isMarkdownContentType(options.contentType);

    // Outer-level byte cap. `stripBlocksFixedPoint` re-checks the same cap
    // internally, but `stripHtmlComments` and `stripMarkdownBeacons` are full
    // scans with no cap of their own, so the gate has to sit here to bound all
    // three. Measured on the post-sanitise bytes, which is what the stages see.
    const exceedsStripCap =
        Buffer.byteLength(content, "utf8") > STRIP_PATH_MAX_BYTES;

    // **A content type the parser REJECTED arrives as `undefined` while
    // `contentTypeUndetermined` stays FALSE, so the two must be tested
    // separately.** `parseResponseWithMetadata` resolves anything failing
    // `MEDIA_TYPE_HEAD` to `undefined`; only a missing `-w` block sets the flag.
    // `LESSONS.md` RC-31.
    //
    // `isSniffableContentType` covers any type that neither declares a grammar
    // handled either way nor is one we deliberately do not sniff
    // (`application/json`). The scan is over the FULL post-sanitise body,
    // bounded by `exceedsStripCap` — a fixed leading window was itself a bypass.
    //
    // **Unreachable from `processResponse`, which passes
    // `contentTypeUndetermined: true` and forces `strictestGrammar`.** It serves
    // direct callers of the published `defendText`.
    const sniffedAsMarkup =
        !exceedsStripCap &&
        !strictestGrammar &&
        !looksLikeJsonBody &&
        isSniffableContentType(options.contentType) &&
        looksLikeMarkupShape(content);
    const needsStripPath = isMarkup || isMarkdown || sniffedAsMarkup;

    // Steps 3-5 share one gate, so the predicate has one source of truth.
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
        // **Two DIFFERENT questions, and collapsing them broke RC-12.**
        // `looksLikeJsonBody` answers *"is this JSON and could the exemption
        // apply"* — and `jsonExemptionCouldApply` is false for a DECLARED markup
        // type, because `isSniffableContentType("text/html")` is false. So on a
        // JSON body mislabelled `text/html` the first term is false while the
        // body is plainly JSON, and the entity decode has to ask the second
        // question directly or it corrupts the document. Removing this arm as
        // "redundant after the reorder" turned three RC-12 cases red
        // immediately; the claim of redundancy was itself the unchecked
        // assertion. RC-12, RC-32.
        //
        // The reorder still bought something here: both terms now read the same
        // post-sanitise string, so the two can no longer answer for different
        // bytes the way `strictestGrammar` and this gate once did.
        const decodeEntities =
            (options.decodeEntities ?? true) && !(looksLikeJsonBody || isDefinitelyJson(content));

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
 * **A JSON document is returned as it arrived, with Step 2 alone.** The strip
 * stages enumerate markup, so on a JSON body they catch the marked-up subset of
 * a class the spotlighting boundary covers in full — and the round trip they
 * needed was not information-preserving: duplicate names collapsed, number
 * lexemes were rewritten, keys reordered. Step 2 is kept because it is not
 * markup-enumerative and is a measured no-op on any realistic JSON body.
 *
 * **Two arms, and no divider is needed, because nothing here rewrites a JSON
 * document** — a pass that does not run cannot span a region. The undivided arm
 * is such a pass only for text that is not itself JSON; a caller genuinely
 * holding two regions emits them as separate MCP content entries rather than
 * relying on this function to find the seam. ARCHITECTURE.md invariant 16,
 * `LESSONS.md` RC-16, RC-37, RC-47.
 */
export function defendForInline(text: string, hostname: string): string {
    if (classifyBody(text).json) return sanitizeAndDetect(text, hostname);
    return defendInlineString(text, hostname);
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
 * **The defence pass is a measurement here, so it must not run when it cannot
 * change the answer.** It is neither free nor side-effect-free — it calls
 * `sanitizeAndDetect`, which logs. Two cheap arms answer first: already-over
 * needs no pass, and growth bounded by {@link MAX_INLINE_GROWTH_RATIO} cannot
 * cross a cap this far away.
 *
 * **The third arm is dead at every live call site**, and is kept rather than
 * deleted because `defendText`'s growing arm is still reachable by a direct
 * caller of the published API. Only JSON reaches this function now — from the
 * body path, and from `jq_query`, whose input its own serialiser produced — and
 * `defendForInline`'s verbatim arm cannot grow text. `LESSONS.md` RC-47.
 *
 * **Two costs recorded so a later round does not rediscover them.** The
 * double-compute is declined rather than unnoticed — threading the defended
 * string back out re-creates the two-shapes-of-content hazard that removing
 * `content` from `ProcessedResponse`'s saved arm eliminated. And the obvious
 * shortcut is unsound: you cannot skip the expensive arm above
 * `STRIP_PATH_MAX_BYTES` on the reasoning that the defence cannot grow a body
 * past the strip cap, because `defendText` sanitises before it checks that cap.
 * `LESSONS.md` RC-15, RC-30.
 *
 * @param hostname - label for the detection log, on the rare arm that runs it
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
 * **Every clause is a claim an LLM will act on, so each is gated on something
 * that can answer it.** Three that were not, each found by review:
 *
 * - **The reader tool is named only where the artefact is in its grammar.**
 *   `jq_query` parses JSON and returns *"Response is not valid JSON"* on
 *   anything else, so pointing a 1 MB `text/html` page at it offers no route at
 *   all. Where the grammar is not JSON, the path is named and the client's own
 *   file tooling is left to it.
 * - **The byte count and the limit claim must be about the same bytes.**
 *   `exceedsInlineCap` weighs the DEFENDED form, which the defence can make
 *   longer, so a 990-byte body can exceed a 1000-byte cap. Both numbers are
 *   labelled — on-disk size, and a limit that applies after the pass — so they
 *   are true together.
 * - **The noun names what is on disk.** With a `jq_filter` the artefact is the
 *   FILTER's output, so a model querying it for a sibling field gets `null` and
 *   reports the origin never sent it.
 *
 * **A content type is never echoed**, and the declared type is not consulted at
 * all. `classifyBody`'s verdict is a fact about the bytes, so absence has
 * nothing to be an arm of. Anything remote-authored inside a sentence this
 * server speaks is indistinguishable to the reader from the server's own words.
 * `LESSONS.md` RC-30, RC-31.
 *
 * `save_to_file` is a request rather than a limit, so the over-cap clause is
 * gated on the bytes genuinely exceeding the cap rather than on which arm asked
 * for the save. Both arms are reachable with `save_to_file: true`.
 */
interface SavedMessageFacts {
    /**
     * Byte length of the buffer that was written — `diskContent.length`.
     *
     * Measured on the buffer rather than re-derived from the string it came
     * from: this is quoted to the model as the size of a file it is about to
     * read, and the two stop agreeing the moment `diskContent` is anything other
     * than a straight encode of `content`.
     */
    diskBytes: number;
    /** Absolute path of the artefact. */
    filepath: string;
    /** The caller's inline budget, named only on the over-cap arm. */
    maxSize: number;
    /** True when the cap forced the save; false when the caller asked for it. */
    overCap: boolean;
    /** True when the artefact is jq output rather than the response body. */
    filtered: boolean;
    /**
     * Why the body was not returned inline, when the reason was the body itself
     * rather than its size. Absent on a JSON artefact.
     */
    rejection?: { reason: JsonRejectionReason };
    /**
     * True when the bytes on disk ARE the origin's octets. False when Step 2
     * changed something, in which case the artefact is the sanitised text.
     *
     * The claim is gated rather than stated because the two arms of
     * `diskContent` write different bytes, and a reader diffing the file
     * against the origin needs to know which one they have.
     */
    originBytesExact: boolean;
}

/**
 * An object rather than six positional arguments, because two of them are
 * `number` and their meanings are not interchangeable. Transposing `diskBytes`
 * and `maxSize` produced *"Response (500000 bytes on disk) … exceeds the
 * 9400000-byte inline limit"* — a sentence that tells a model to raise
 * `max_result_size` to clear a limit it never hit — and it compiled, and it
 * passed, because the only assertion on that arm was `toContain("exceeds the")`.
 * The shape is the fix; there is no runtime check to add. `LESSONS.md` RC-31.
 */
function savedMessage(facts: SavedMessageFacts): string {
    const { diskBytes, filepath, maxSize, overCap, filtered, rejection, originBytesExact } = facts;
    const subject = filtered ? "Result of jq_filter" : "Response";

    // The declared content type is not echoed: this string is server-authored
    // prose a model reads as ours, and a remote-echoed token inside it is the
    // shape invariant 13 admits only in last position. The reason and the byte
    // count carry zero remote bytes by construction — see
    // {@link JsonRejectionReason}.
    //
    // The two causes are not exclusive: a body can be non-JSON AND over the
    // inline cap, and short-circuiting on the rejection left a model told only
    // that the body was not JSON, with no reason to think raising
    // `max_result_size` would not help.
    const capClause = overCap
        ? ` It also exceeds the ${maxSize}-byte inline limit once the inline defence pass is applied.`
        : "";
    const cause = rejection !== undefined
        ? `${subject} (${diskBytes} bytes on disk) was saved to: ${filepath} — it is not JSON ` +
          `(${rejection.reason}), so no body is returned here.${capClause}`
        : overCap
        ? `${subject} (${diskBytes} bytes on disk) was saved to: ${filepath} — it exceeds the ` +
          `${maxSize}-byte inline limit once the inline defence pass is applied, so no body is ` +
          `returned here.`
        : `${subject} (${diskBytes} bytes) saved to: ${filepath}.`;

    // Two arms, and neither reads the declared content type. `rejection` is
    // present exactly when `classifyBody` said the body is not JSON, so the
    // other arm's body IS — and `jq_query` can always read it. Re-deriving that
    // from the header asked a remote-written field a question already answered,
    // and got it wrong whenever an origin served valid JSON as `text/html`.
    const route =
        rejection !== undefined
            ? " The body is not JSON, so the jq_query tool cannot parse it; read the path with" +
              " your own tooling." +
              (originBytesExact
                  ? " The file holds the origin's exact bytes."
                  : " The file holds the body with attack codepoints removed, so it is not" +
                    " byte-identical to what the origin sent.")
            : " Use the jq_query tool on that path to extract fields.";

    const scope = filtered
        ? " That file holds the FILTER OUTPUT, not the full response body."
        : "";

    return cause + route + scope;
}

/**
 * Classify the body, then return it, save it, or report it.
 *
 * 1. Size guard against {@link LIMITS.MAX_RESPONSE_SIZE}, on the wire octets and
 *    again on the decode — a body that is not valid UTF-8 decodes LARGER,
 *    because each bad sequence becomes a three-byte replacement character.
 * 2. **Sanitise + detect**, always, and the only defence pass on this path.
 * 3. Classify, once, with {@link classifyBody}.
 * 4. A `jq_filter` runs only on a JSON body, and its output is re-sanitised
 *    because `JSON.parse` can decode an escape into a real attack codepoint.
 * 5. A JSON body inside `maxResultSize` is returned; anything else is saved and
 *    its path reported.
 *
 * **No strip stage runs here, on either arm.** ARCHITECTURE.md invariants 1a and
 * 14 carry why, and `LESSONS.md` RC-47 carries who decided it. `defendText`
 * keeps every stage for the channels that still need them.
 *
 * **Takes the wire octets, not a decoded string**, for two reasons: the size
 * guard must quote a byte count the origin can be held to, and taking the buffer
 * rather than a `(text, bytes)` pair makes it impossible for the two to
 * disagree. The decode happens once, here. `LESSONS.md` RC-33.
 *
 * @param responseBytes - The body's wire octets, from
 *                        {@link ParsedResponse.bodyBytes}. Runtime-checked
 *                        because this function is not on a published entry point
 *                        and so has no compiler-checked caller but its one
 *                        in-repo one
 * @param options - Processing options (url, jqFilter, maxResultSize, etc.)
 * @returns ProcessedResponse — the inline arm carries `content`; the saved arm
 *          carries `filepath` and `message` and no body bytes at all
 * @throws TypeError if `responseBytes` is not a Buffer
 * @throws Error if the body exceeds the absolute size cap, or a jq_filter was
 *   asked for on a body that is not JSON
 */
export async function processResponse(
    responseBytes: Buffer,
    options: ProcessResponseOptions
): Promise<ProcessedResponse> {
    if (!Buffer.isBuffer(responseBytes)) {
        throw new TypeError("processResponse: responseBytes must be a Buffer");
    }

    // Step 1: size guard, on both representations. `ARCHITECTURE.md` invariant
    // 14 owns the reasoning and the measurement.
    //
    // This arm is defence-in-depth: `command-executor.ts`'s `accountFor`
    // enforces the same ceiling while the body is still streaming, so nothing
    // arriving through `curl_execute` reaches here over-cap. It is kept because
    // it is what lets the decoded arm below claim the body is not valid UTF-8 —
    // with this check first, that arm can only fire on a body that isn't.
    const rawBytes = responseBytes.length;
    if (rawBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes) exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes)`
        );
    }

    // The request's only decode of the body. `ParsedResponse` carries octets
    // alone so that this is the single place it happens: on a 10 MB body a
    // second decode costs both the CPU and a second live copy.
    //
    // Lossy for any non-UTF-8 origin, which is why the message above quotes the
    // wire count rather than this string's length.
    const response = responseBytes.toString("utf8");
    // **Measured here because this is the only place both forms exist.** A
    // re-encode that does not reproduce the wire octets means the decode
    // replaced something, and downstream nothing can tell U+FFFD the origin
    // sent from U+FFFD this line produced. The body may still parse as JSON —
    // Latin-1 `Jos\xE9` becomes `Jos\uFFFD`, valid JSON with a wrong value —
    // so classification cannot catch it and the byte-exactness contract would
    // otherwise be asserted over a body that was re-encoded. Reported, not
    // corrected: the origin's octets are unrecoverable from the decode, and
    // they are on disk untouched wherever this body is saved.
    // Reported by chatgpt-codex-connector on PR #39; `LESSONS.md` RC-15.
    const decodeWasLossy = !Buffer.from(response, "utf8").equals(responseBytes);
    const lossy = decodeWasLossy ? ({ decodeWasLossy: true } as const) : {};

    // **The binding gate.** This is the arm that bounds every stage below, and
    // it is reachable only for a body whose decode inflated past the ceiling
    // while its wire form fit — i.e. a body that is not valid UTF-8, which is
    // why the message may say so. Both numbers are reported, because a caller
    // told only the inflated one cannot tell an oversized response from an
    // undecodable one.
    const decodedBytes = Buffer.byteLength(response, "utf8");
    if (decodedBytes > LIMITS.MAX_RESPONSE_SIZE) {
        throw new Error(
            `Response size (${rawBytes} bytes on the wire, ${decodedBytes} bytes decoded) ` +
                `exceeds maximum allowed (${LIMITS.MAX_RESPONSE_SIZE} bytes). The body is not ` +
                `valid UTF-8, and replacement characters make the decoded form larger than the wire form.`
        );
    }

    // Resolve hostname once for injection-detection logging; the defence
    // pipeline and the post-jq re-sanitise below both label with it.
    const hostname = safeHostname(options.url);

    // **The gate, once, for both the body and the artefact.** Everything below
    // forks on this and nothing re-derives it — `docs/todos/018` requires the
    // two decisions be the same rule spelled once, because they are the same
    // question: may these bytes be handed over unmodified?
    // **Sanitise first, then classify — the order is the fix for a measured
    // defect.** `classifyBody` used to run on the raw decode, while every
    // defence pass below runs on the sanitised form, so the two disagreed on
    // any body Step 2 alters. Measured: `\uFEFF{"a":"see <!-- x -->","b":"y"}`
    // — an ordinary BOM-prefixed JSON body, which .NET and Java services emit
    // routinely — was classified `invalid-syntax`, forced to disk, and then
    // handed to `defendText`, which sanitised the BOM away and ran the full
    // strip over what was now valid JSON: the artefact came back
    // `{"a":"see ","b":"y"}`, a field deleted, on the only copy.
    //
    // This is the same reorder RC-32 already applied INSIDE `defendText`, which
    // is exactly why the outer gate looked safe and was not.
    //
    // The call also carries Step 2's detection side effect, which the JSON arm
    // would otherwise lose entirely: byte-exactness withholds the sanitise and
    // says nothing about the log, but handing the body straight through
    // withheld both — so a saved body carrying `Ig\u200bnore previous
    // instructions` produced no `[injection-defense]` line at all.
    // `LESSONS.md` RC-44.
    // **Sanitise BEFORE classifying, because both must see the same bytes.** A
    // BOM-prefixed body does not parse and sanitise removes the BOM, so
    // classifying the raw decode routed valid JSON from a .NET or Java origin to
    // the non-JSON arm and ran the full strip over the only copy. Step 2 also
    // LOGS, which is why it sits above the fork rather than inside an arm:
    // handing a JSON body straight through withheld both jobs, so a saved body
    // carrying an injection phrase produced no `[injection-defense]` line at
    // all. `LESSONS.md` RC-44.
    const sanitised = sanitizeAndDetect(response, hostname);
    const classified = classifyBody(sanitised);
    // Where Step 2 changed nothing, the sanitised text IS the origin's decode,
    // so the wire octets can go to disk exactly. Where it changed something,
    // those octets would be a file `jq_query` cannot parse.
    const sanitiseWasNoOp = sanitised === response;

    // **No defence pass on the body path.** A JSON body is returned as it
    // arrived. A non-JSON body is not returned inline at all — only reported —
    // so there is no model-facing text to defend, and the artefact keeps the
    // origin's bytes so an HTML error page stays readable to whoever opens it.
    let content = sanitised;

    // Step 6: Apply jq filter if provided AND response is JSON.
    //
    // **"A filter produced this content" and "a filter was requested" are
    // different questions, and `savedMessage` needs the first.** They diverge on
    // any falsy-but-present filter: the gate below skips, so the content is the
    // whole body, while `options.jqFilter !== undefined` would say otherwise —
    // and `savedMessage` would then name the file as filter output and tell the
    // model to expect a subset. One flag set where the transform happens is what
    // makes the wrong answer unavailable rather than merely unused.
    //
    // Its one reader is `savedMessage`'s `filtered`. The disk decision does not
    // consult it; the save arm below says why.
    let filterApplied = false;
    if (options.jqFilter) {
        const trimmed = content.trim();

        // **Two different questions, and collapsing them onto one gate lost
        // data.** `classified.json` answers *may these bytes be handed over
        // unmodified* — composite only, because a bare scalar's artefact has no
        // in-process reader. A filter asks something weaker: *does this parse at
        // all*. A filter runs perfectly well on a top-level scalar.
        //
        // Routing the filter through the artefact gate made
        // `curl_execute({ url, jq_filter })` THROW on an endpoint returning
        // `null` for "no record", `42` for a count or `"ok"` for a health check
        // — and the throw sits above `shouldSave`, so the body was not saved
        // either. It was discarded outright, where the same body without a
        // filter is persisted and reported. `LESSONS.md` RC-45.
        //
        // So this gate is the parse alone. `empty-body` and `looks-like-markup`
        // still cannot be filtered; a scalar can.
        if (!classified.json) {
            // **The reason comes from the closed vocabulary, not from the
            // header.** `options.contentType` is origin-written, so echoing it
            // put remote text into server-authored error prose; and it answers
            // a question this path no longer asks — `classifyBody` decided on
            // the bytes. `JsonRejectionReason` carries no response byte by
            // construction.
            throw new Error(
                `Cannot apply jq_filter: Response is not JSON (${classified.reason})`
            );
        }

        // Parse JSON once and reuse for both validation and filtering
        let parsedData: unknown;

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
        // Set HERE, past every throw above, so it means "a filter produced this
        // content" rather than "a filter was requested".
        filterApplied = true;

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
    // Only a JSON body has an inline representation, so it is the only body
    // weighed against the inline cap: a non-JSON body is saved for what it IS,
    // and claiming it "also exceeds the inline limit once the inline defence
    // pass is applied" would cite a pass that no longer runs here.
    const overCap = classified.json && exceedsInlineCap(content, hostname, maxSize);

    // **A non-JSON body is always saved and never returned inline.** An agent
    // can often recover from a body that nearly parses — a PHP warning
    // prepended, a BOM, an HTML error page from a proxy — so the bytes are kept
    // and the path reported; what is not returned is arbitrary remote text
    // inline.
    //
    // **`empty-body` is excluded, because the save rule was never argued for
    // it.** A `204`, a `HEAD` or a `304` from an ordinary REST endpoint was
    // writing a ZERO-BYTE file and telling the model to read it. An empty body
    // is returned as empty, unless the caller asked for a file.
    // **`filterApplied` is in this condition because the classification above
    // describes the ORIGINAL body, and a filter has replaced it.** Once
    // `applyJqFilterToParsed` has run, the content is our own serialiser's
    // output and therefore valid JSON by construction — so keying the save on
    // the original body's verdict forced a 4-byte filter result to disk and
    // reported it as an unreturnable non-JSON body. Found by the case that
    // exercises a scalar body with a filter. `LESSONS.md` RC-45.
    // An empty body is a legitimate response — 204, 304, a HEAD request — so it
    // is returned as the empty string rather than reported as a failed parse.
    // Still saved where the caller explicitly asked for a file.
    const emptyBody = !classified.json && classified.reason === "empty-body";
    if (emptyBody && !options.saveToFile) return { content: "", savedToFile: false, ...lossy };

    const shouldSave = options.saveToFile || overCap || (!classified.json && !filterApplied);

    if (shouldSave) {
        // **The artefact's form is decided by the gate, never by the declared
        // header** — `docs/todos/018` settles this, and the header is invariant
        // 1a's named failure shape precisely because a remote writes it.
        //
        // - **A JSON document is persisted as the ORIGIN'S OCTETS**, byte for
        //   byte, which is what `docs/todos/016` asked for and could not have
        //   until this todo settled who reads the file. Its reader is
        //   `jq_query`, which is inside this process and runs the full
        //   `defendForInline` pass over what it reads — so byte-exactness here
        //   costs no defence, and it is exactly where RC-33's loss hurt:
        //   duplicate keys, integers past `Number.MAX_SAFE_INTEGER`, `"1.50"`.
        //   The filtered arm is our own serialiser's output rather than the
        //   origin's, so there are no origin octets to preserve.
        // - **Anything else is persisted as the DEFENDED text.** `jq_query`
        //   cannot open a non-JSON file, so `savedMessage` routes the model to
        //   the host's own file tooling — outside every defence. Raw octets
        //   there would withdraw Step 2 sanitisation from the one
        //   representation the model is instructed to read, which is the P1 the
        //   016 revert closed.
        //
        // `ARCHITECTURE.md` invariant 14 states both halves.
        // **One rule, both arms: persist the origin's octets unless Step 2 had to
        // change something.** Where it did, the raw octets are a file whose
        // reader cannot use them — a BOM defeats `jq_query`'s parse — so the
        // sanitised form goes down instead and the exactness claim narrows to
        // what is true. A filter is the third case: then the artefact is the
        // filter's output, not the response.
        //
        // No strip stage runs on either arm, which is what keeps an HTML error
        // page readable: `stripHtmlComments` would delete the `<!-- trace-id -->`
        // a framework put the diagnostic in.
        const diskContent = filterApplied
            ? Buffer.from(content, "utf8")
            : sanitiseWasNoOp
            ? responseBytes
            : Buffer.from(sanitised, "utf8");
        const filepath = await saveResponseToFile(diskContent, options.url, options.outputDir);
        // **No body bytes are returned on this arm, and that is the whole
        // saving.** `formatResponse`'s file branch emits `saved_to_file`,
        // `filepath` and `message` and never reads the body, so a defence pass
        // over it produces nothing the model sees — measured at 91 ms of a
        // 197 ms call on a 9.4 MB body (`docs/todos/008`).
        //
        // Returning no body bytes makes invariant 14 trivially true here rather
        // than narrowly true: the cap cannot be exceeded by bytes that are not
        // returned. `ProcessedResponse`'s saved arm carries no `content` field
        // at all, so this is enforced by the type and not by this comment.
        //
        // The body is not lost — it is on disk in the origin's grammar, and
        // `message` below names the tool that reads it.
        return {
            savedToFile: true,
            filepath,
            ...lossy,
            message: savedMessage({
                // Measured on the buffer that was written, so the number
                // describes the file whatever `diskContent` is built from.
                diskBytes: diskContent.length,
                filepath,
                maxSize,
                overCap,
                filtered: filterApplied,
                // The filter arm writes the filter's output, and the
                // non-no-op arm writes sanitised text; only the third arm
                // is the origin's octets.
                originBytesExact: !filterApplied && sanitiseWasNoOp,
                // Only where the body itself was the reason. An over-cap JSON
                // document is saved too, and there is nothing wrong with it.
                ...(classified.json ? {} : { rejection: classified }),
            }),
        };
    }

    return {
        content,
        savedToFile: false,
        ...lossy,
    };
}
