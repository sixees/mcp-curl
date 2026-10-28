// src/lib/response/processor.ts
// Orchestrate response processing with filtering and size handling

import { LIMITS } from "../config/limits.js";
import { applyJqFilterToParsed } from "../jq/index.js";
import { saveResponseToFile } from "./file-saver.js";
import {
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
    sanitizeResponse,
    supportsMarkupComments,
} from "../utils/index.js";
import { detectJsonAndLog, sanitizeAndDetect } from "../security/index.js";

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
     * stage runs and a remote cannot disable beacon stripping by making the
     * metadata unreadable.
     *
     * **Required, not optional, and that is the whole point.** Both fields that
     * select the grammar are absent-able, so an optional flag defaulting
     * permissive would let `defendText(text, { hostname })` compile, look
     * defended, and run Step 2 alone. Pass `false` when you know the content
     * type (including knowing the origin sent none), `true` when you could not
     * determine it.
     *
     * **The type is only half the fix, because a type is not a runtime check.**
     * This function is on the published entry point, and a JavaScript consumer can omit the
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
     * **The exemption is about the artefact, not the model.** A caller of the
     * published function may persist what it defends, and rewriting `<script>`
     * or `[a](b)` inside a JSON string value would silently alter that document.
     * No in-repo caller persists `defendText`'s output — `processResponse` never
     * calls it, and writes the origin's octets, a filter's output, or the sanitised
     * text of a non-JSON body Step 2 changed — and `defendForInline` passes
     * `false` because it has already answered the JSON question with
     * {@link classifyBody} and returns a JSON document before reaching here. See
     * `LESSONS.md` RC-10.
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
 * **Every scalar first character is listed, not just `{` and `[`.** Those two
 * cover the documents people picture; omitting the rest would send a scalar
 * document to the strictest grammar and rewrite the beacon inside it — the
 * exact outcome the JSON exemption exists to prevent (`LESSONS.md` RC-10).
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
 * Used by `defendText` to decide whether a JSON document may skip the
 * markdown/markup strip stages — under an undetermined or sniffable content
 * type — and whether the entity decode may run on it, whatever the declared
 * type. It must be a parse rather than a shape test:
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
 * `processResponse`'s jq branch does not use this function: it is gated on
 * {@link classifyBody}'s verdict, which the filter's own parse then agrees with.
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
 * - `invalid-syntax` — the parse threw and none of the above applies.
 *
 * **A bare scalar is not a member, and its absence is the rule.** `null`, `42`
 * and `"ok"` parse, so {@link classifyBody} returns `{ json: true }` for them
 * and no reason is issued — a filter runs on a scalar perfectly well, and
 * routing them through a rejection is what `LESSONS.md` RC-45 removed.
 */
export type JsonRejectionReason = "empty-body" | "looks-like-markup" | "invalid-syntax";

/**
 * What the body path decided about a response body.
 *
 * `json: true` is the only arm whose bytes are returned to the model.
 * Unfiltered, they are returned and persisted as the origin sent them; a
 * `jq_filter`'s output replaces them on both.
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
        //
        // **`trimmed`, the same string the two checks above were given.** They
        // agree with the parse only if all three see one value: `trim()` removes
        // U+FEFF and `JSON.parse` rejects it, so parsing the untrimmed text would
        // classify a BOM-prefixed document `invalid-syntax` while every other
        // layer read it as JSON — and `defendForInline` would send it to the
        // strip arm, where `stripHtmlComments` pairs `<!--` in one field with
        // `-->` in a later one and deletes the fields between, leaving a result
        // that still parses. .NET and Java origins emit a BOM routinely, and both
        // `processResponse` and the wrap classify the unsanitised text, so neither
        // has a Step 2 ahead of this to remove it.
        JSON.parse(trimmed);
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
 * **This is the single defence path for remote-origin text that is not a JSON
 * document, and it exists as a shared function so that no caller can assemble
 * a shorter one** — a text channel holding only `sanitizeAndDetect` (Step 2)
 * would pass markdown beacons, `<script>`/`<style>` blocks and
 * numeric-entity-masked injections to the model. A JSON document is the
 * deliberate exception: {@link defendForInline} detects on it and returns it
 * unchanged (`LESSONS.md` RC-49).
 *
 * The stages, in order, and the order is load-bearing:
 *
 * - **Step 2** — sanitise + detect, ALWAYS, on the original text and its
 *   sanitised form: the original keeps the signal for anything a later stage
 *   erases, the sanitised form joins a phrase an invisible character split.
 * - **Steps 3-4** — markup comments, the `<script>`/`<style>` strip, and (for
 *   declared markdown) beacon removal. Gated on the strip-path cap so the cost
 *   stays bounded on adversarial input.
 * - **Step 5** — re-sanitise + detect, because the strip path's numeric-entity
 *   decoder unmasks `&#x69;gnore previous instructions` into a real injection
 *   phrase that Step 2 could not see.
 *
 * {@link processResponse} does not call this — the body path rewrites nothing
 * and returns only JSON inline. The in-repo callers are `defendForInline`'s
 * non-JSON arm, the header channel and cURL stderr in `curl-execute.ts`; a
 * published consumer calls it for any other text channel it builds.
 *
 * @param text - Remote-origin text to defend
 * @param options - Content-type (selects strip stages) and hostname (logging)
 * @returns The defended text; never suppressed, only rewritten
 */
export function defendText(text: string, options: DefendTextOptions): string {
    let content = text;
    // Omission resolves to the STRICTEST grammar, not the permissive one. The
    // type makes this field required, which binds TypeScript callers and does
    // nothing at runtime — and this function is on the published entry point, so a JavaScript
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
    // `content` and sanitising changes it, so deciding first would act on bytes
    // the stages never see — one zero-width space would be enough to lose the
    // exemption and splice two fields out of a document. The same order makes
    // `isDefinitelyJson`'s byte gate measure the same bytes as `exceedsStripCap`.
    // Detection is unaffected: `sanitizeAndDetect` tests its input, the original
    // text, and the sanitised form alike. `LESSONS.md` RC-16, RC-31, RC-32.
    // Step 2 — sanitise + detect, ALWAYS, whatever the body declares.
    //
    // Gating this on content type would be attacker-controllable: `Content-Type:
    // image/png` on an HTML body would disable the whole pipeline. The body here
    // is always a string, and sanitising it can only remove attack-class
    // codepoints and collapse padding — both no-ops on a legitimate binary
    // preview. Detection reads this function's INPUT as well as the sanitised
    // form, so the log signals on what the origin actually sent and on a phrase
    // an invisible character split.
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
    // `MEDIA_TYPE_HEAD` to `undefined`; only an unlocated `-w` block sets the flag.
    // `LESSONS.md` RC-31.
    //
    // `isSniffableContentType` covers any type that neither declares a grammar
    // handled either way nor is one we deliberately do not sniff
    // (`application/json`). The scan is over the FULL post-sanitise body,
    // bounded by `exceedsStripCap` rather than a fixed leading window, which a
// remote could pad its markup past.
    //
    // **Unreachable from every in-repo caller.** `defendForInline` passes
    // `contentTypeUndetermined: true` with the JSON exemption off, which forces
    // `strictestGrammar`; the header and stderr channels declare markdown, which
    // is not sniffable. It serves direct callers of the published `defendText`.
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
        // declared. The decode's output is what gets RETURNED — and a caller
        // of the published function may persist it — and `&#x22;` decodes to
        // `"`, which ends a JSON string: `{"q":"a &#x22;b&#x22;"}` declared
        // `text/html` would come back as `{"q":"a "b"}`, which no longer parses.
        //
        // Gating the decode here rather than at each caller is what makes the
        // sniffed and DECLARED-markup arms agree: the sniffed arm excludes JSON
        // bodies on its own, so without this gate one mislabelled Content-Type
        // is enough to reach the decode. `LESSONS.md` RC-12.
        //
        // **The two terms answer DIFFERENT questions, and neither is
        // sufficient alone.** `looksLikeJsonBody` answers *"is this JSON and
        // could the exemption apply"*, and `jsonExemptionCouldApply` is false
        // for a DECLARED markup type because `isSniffableContentType`
        // ("text/html") is false. So on a JSON body mislabelled `text/html` the
        // first term is false while the body is plainly JSON, which is why the
        // second asks directly. **Neither term is redundant** — dropping this
        // arm fails three RC-12 cases. RC-12, RC-32.
        //
        // Both terms read the same post-sanitise string, so they cannot answer
        // for different bytes.
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
 * The post-processor wrap applies this to every text part, and it is the only
 * production caller. The size gates in `processResponse` and `executeJqQuery`
 * weigh JSON alone, as-is, and that is sound only because the JSON arm below
 * returns it unchanged — a change that lengthens a JSON document here breaks
 * invariant 14 silently, which `processor.test.ts`'s "the JSON arm returns a
* document unchanged, so the gate measures what the model receives" case pins.
 *
 * The options and their reasons:
 *
 * - `contentTypeUndetermined: true` — at these boundaries the grammar
 *   genuinely is unknown, so the STRICTEST arm runs and every stage fires.
 * - `excludeJsonDocuments: false` — `defendForInline` has already decided the
 *   JSON question with `classifyBody`, so this stops `defendText` re-asking it
 *   with `isDefinitelyJson` and answering differently. The exemption itself is
 *   about a persisted artefact, and nothing inline is persisted: persisted
 *   keeps it, returned does not (`LESSONS.md` RC-10).
 * - `decodeEntities: false` — the decode's output is what gets returned, so on
 *   a channel whose consumer does not itself decode it would manufacture live
 *   markup from inert bytes (`LESSONS.md` RC-3). Its cost is stated on
 *   `processTextPart` and in ARCHITECTURE.md invariant 1a.
 *
 * **The non-JSON arm can make text LONGER** — `[link removed]` is 14 bytes and
 * the shortest form it replaces is 9 — which is why no size gate is applied to
 * non-JSON text as though it were returned as-is. `LESSONS.md` RC-15.
 *
 * **A JSON document is returned exactly as it arrived: detected and logged,
 * never rewritten.** The payload is the agent's to interpret, not this server's
 * to sanitise (`LESSONS.md` RC-49) — and the strip stages, which enumerate
 * markup, only ever caught the marked-up subset of a class the spotlighting
 * boundary covers in full, at the price of a round trip that was not
 * information-preserving. Detection stays, because the per-host log is an
 * operator signal rather than a payload rewrite (ARCHITECTURE.md invariant 7).
 *
 * **Two arms, and no divider is needed, because nothing here rewrites a JSON
 * document** — a pass that does not run cannot span a region. The undivided arm
 * is such a pass only for text that is not itself JSON; a caller genuinely
 * holding two regions emits them as separate MCP content entries rather than
 * relying on this function to find the seam. ARCHITECTURE.md invariant 16,
 * `LESSONS.md` RC-16, RC-37, RC-47.
 */
export function defendForInline(text: string, hostname: string): string {
    if (classifyBody(text).json) {
        detectJsonAndLog(text, hostname);
        return text;
    }
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
 * - **The byte count and the limit claim must be about the same bytes.** The
 *   gate weighs the body as the model would receive it and the count is
 *   measured on the buffer written; for an unfiltered JSON document those are
 *   the same octets, so the two numbers are true together.
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
     * True when the bytes on disk ARE the origin's octets. False on a filter's
     * output, and on a non-JSON body Step 2 changed, whose artefact is the
     * sanitised text.
     *
     * The claim is gated rather than stated because the arms of `diskContent`
     * write different bytes, and a reader diffing the file against the origin
     * needs to know which one they have.
     */
    originBytesExact: boolean;
    /**
     * Byte length of `content` as the inline gate measures it. On the over-cap
     * arm — the only one that quotes it — the content is JSON, and on disk as
     * the origin's octets unless a `jq_filter` produced it, in which case both
     * counts measure the same buffer. They differ only on an unfiltered lossy
     * decode, where each undecodable sequence grew to three bytes; quoting both
     * keeps the count from reading below the limit it says was exceeded.
     */
    measuredBytes: number;
    /** True when the UTF-8 decode replaced something; see `decodeWasLossy`. */
    decodeWasLossy: boolean;
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
    const {
        diskBytes, filepath, maxSize, overCap, filtered, rejection, originBytesExact,
        measuredBytes, decodeWasLossy,
    } = facts;
    const measured = measuredBytes === diskBytes ? "" : `, ${measuredBytes} once decoded`;
    const subject = filtered ? "Result of jq_filter" : "Response";

    // The declared content type is not echoed: this string is server-authored
    // prose a model reads as ours, and a remote-echoed token inside it is the
    // shape invariant 13 admits only in last position. The reason and the byte
    // count carry zero remote bytes by construction — see
    // {@link JsonRejectionReason}.
    //
    // The two causes are exclusive: `overCap` is computed on the JSON arm only,
    // and `rejection` exists only on the other one.
    const cause = rejection !== undefined
        ? `${subject} (${diskBytes} bytes on disk) was saved to: ${filepath} — it is not JSON ` +
          `(${rejection.reason}), so no body is returned here.`
        : overCap
        ? `${subject} (${diskBytes} bytes on disk${measured}) was saved to: ${filepath} — it ` +
          `exceeds the ${maxSize}-byte inline limit, so no body is returned here.`
        : `${subject} (${diskBytes} bytes) saved to: ${filepath}.`;

    // **Which form reached disk is stated on BOTH arms**, because both arms
    // can hold the origin's octets and the reader diffing the file against the
    // origin needs to know which one they have. Only a non-JSON body Step 2
    // changed is written sanitised.
    //
    // Withheld for a filter's output alone: there `scope` below already says the
    // file is not the response body, which is the stronger statement.
    const exactness = filtered
        ? ""
        : originBytesExact
        ? " The file holds the origin's exact bytes."
        : " The file holds the body with attack codepoints removed and long whitespace" +
          " or newline runs collapsed" +
          (decodeWasLossy ? ", and each undecodable sequence replaced with U+FFFD" : "") +
          ", so it is not byte-identical to what the origin sent.";

    // Two arms, and neither reads the declared content type. `rejection` is
    // present exactly when `classifyBody` said the body is not JSON, so the
    // other arm's body IS — and `jq_query` can always read it. The rejection arm
    // claims nothing about `jq_query` either way: its sanitised artefact can
    // parse where the origin's body did not (an invisible character between
    // tokens), so "cannot parse it" would be false there. Deriving that from
    // the header would ask a remote-written field a question already answered,
    // and get it wrong whenever an origin serves valid JSON as `text/html`.
    //
    // **Over the cap, the saved file comes first and a narrower request second.**
    // The bytes have already crossed the wire, and analysing them locally costs
    // nothing, where a re-request spends quota on a rate-limited API — so the
    // file is offered as the answer and narrowing is offered for next time,
    // never as a retry. That is why RC-49's "ask the API for less data" is not
    // the advice here: it reads as free and is not. `LESSONS.md` RC-63.
    const narrowing = overCap
        ? ` To get the body inline instead, narrow the next request — fewer fields, a limit, or` +
          ` pagination${filtered ? ", or a tighter jq_filter" : ""}.`
        : "";
    const route =
        rejection !== undefined
            ? " The body is not JSON; read the path with your own tooling." + exactness
            : (overCap ? " The saved file is valid to analyse." : "") +
              " Use the jq_query tool on that path to extract fields" +
              (overCap ? "; that costs no further request." : ".") +
              exactness +
              narrowing;

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
 * 2. **Detect**, always, on the origin's decode, on its sanitised form and on
 *    each string token that carries an escape, decoded on its own.
 *    Nothing on this path rewrites a JSON payload.
 * 3. Classify, once, with {@link classifyBody}, over the origin's decode — the
 *    same question the wrap asks of every text part. The sanitised form is
 *    persisted only for a non-JSON body it differs from.
 * 4. A `jq_filter` runs only on a JSON body, and its output is re-detected
 *    because jq can assemble a phrase no single value holds.
 * 5. A JSON body inside `maxResultSize` is returned as the origin's decode,
 *    and an empty body as `""` unless a save was asked for; anything else is
 *    saved and its path reported.
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
 * @throws Error if the body exceeds the absolute size cap. A `jq_filter` on a
 *   body that is not JSON is skipped and the body saved, never thrown on
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
    // they are on disk untouched wherever the artefact is the origin's octets —
    // every unfiltered JSON body, and any non-JSON body Step 2 left unchanged.
    // `ARCHITECTURE.md` invariant 1a; `LESSONS.md` RC-33.
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

    // Resolve hostname once for injection-detection logging; detection on the
    // body and the post-jq re-detect below both label with it.
    const hostname = safeHostname(options.url);

    // **The gate, once, for both the body and the artefact.** Everything below
    // forks on this and nothing re-derives it — `docs/todos/018` requires the
    // two decisions be the same rule spelled once, because they are the same
    // question: may these bytes be handed over unmodified?
    //
    // **It classifies the origin's decode, and so does every other reader.**
    // `classifyBody` trims, which is what lets a BOM-prefixed document from a
    // .NET or Java origin read as the JSON it is; the wrap's `defendForInline`
    // asks the same function the same question, and `jq_query` trims the same
    // way before it parses. One verdict per body, whichever tool carried it.
    //
    // **Detection sits above the fork, and it reads the sanitised form and each
    // escaped string token, decoded, as well as the original**: a zero-width
    // space inside a phrase hides it from the first, and `\u0049gnore` hides it
    // from both text forms until decoded (`detectJsonAndLog`). Nothing is rewritten —
    // the payload is the agent's, not this server's (`LESSONS.md` RC-49) — while
    // the `[injection-defense]` line is an operator signal invariant 7 forbids
    // suppressing.
    const sanitised = sanitizeResponse(response);
    detectJsonAndLog(response, hostname, sanitised);
    const classified = classifyBody(response);
    // **What reaches disk, unfiltered: the origin's octets, unless a non-JSON
    // body was changed by Step 2.** A JSON document always goes down as sent.
    // A non-JSON body is read with the host's own tooling, outside every
    // defence, so where Step 2 found something to remove the file holds the
    // sanitised text instead, and `savedMessage` says so.
    const originOnDisk = classified.json || sanitised === response;

    // **No defence pass on the body path.** A JSON body is returned as it
    // arrived. A non-JSON body is not returned inline at all — only reported —
    // so there is no model-facing text to defend.
    let content = response;

    // Step 4: Apply jq filter if provided AND response is JSON.
    //
    // **"A filter produced this content" and "a filter was requested" are
    // different questions, and `savedMessage` needs the first.** They diverge on
    // any falsy-but-present filter: the gate below skips, so the content is the
    // whole body, while `options.jqFilter !== undefined` would say otherwise —
    // and `savedMessage` would then name the file as filter output and tell the
    // model to expect a subset. One flag set where the transform happens is what
    // makes the wrong answer unavailable rather than merely unused.
    //
    // Read by the save decision, by the artefact's form and by `savedMessage`'s
    // `filtered`.
    let filterApplied = false;
    // **A filter is skipped on an unparseable body, never fatal to it.** The
    // gate is the same parse `classifyBody` runs, scalars included, so a
    // filter runs on an endpoint returning `null` for "no record", `42` for a
    // count or `"ok"` for a health check rather than throwing on it.
    // `LESSONS.md` RC-45.
    //
    // **Skipping rather than throwing is what keeps the non-JSON contract
    // whole.** The save happens after this block, so a throw here would discard
    // the body outright — an HTML proxy error page fetched with a filter would
    // yield no path and no byte count, where the same page without a filter is
    // persisted and reported. `docs/todos/018` → *Bad JSON:
    // report, save, do not inline* and `curl_execute`'s own description both
    // promise that save unconditionally. Falling through leaves `filterApplied`
    // false, so `shouldSave`'s `(!classified.json && !filterApplied)` arm takes
    // it and `savedMessage` names the reason, the byte count and the path.
    //
    // The requested filter is not separately reported as refused, because
    // `savedMessage` is told *a filter produced this content* and not *a filter
    // was asked for* — see `filterApplied`'s reader below. "It is not JSON
    // (`reason`), so no body is returned here" already says why nothing was
    // filtered.
    if (options.jqFilter && classified.json) {
        const trimmed = content.trim();

        // A second parse: `classifyBody` validated without a reviver, and the
        // filter needs `keepNumberLexeme`
        let parsedData: unknown;

        try {
            // Same reviver as `jq_query`: this branch re-serialises through `applyJqFilterToParsed`, so without
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

        // Re-detect after the filter, because a multi-path filter can place two
        // values side by side — `.a,.b` puts halves the origin kept apart within
        // the pattern's proximity window — and with `detectJsonAndLog`, because
        // the output is `JSON.stringify`'s, which writes a decoded newline or
        // control character back as an escape. **Detect,
        // never rewrite** — the filter's output is the origin's data, selected, and
        // the same middleware contract as the unfiltered body applies (`LESSONS.md`
        // RC-49).
        //
        // **Runs UNCONDITIONALLY, because any content-type gate here is
        // origin-controlled.** Labelling JSON `application/octet-stream` would
        // be enough to skip this pass. Reaching this line means jq produced a
        // textual result, whatever the origin called it.
        detectJsonAndLog(content, hostname);
    }

    // Step 5: Determine max size and decide save-to-file.
    //
    // **The cap is enforced here, not at the wrap**, because by then the body
    // is sealed inside `formatResponse`'s JSON envelope: there is no discrete
    // body left to bound, a byte-truncation would cut the envelope mid-JSON,
    // and the wrap has no file to save to. Measured: a compliant 1000-byte body
    // arrives at the wrap as a 1057-byte text part under `include_metadata`.
    const maxSize = options.maxResultSize ?? LIMITS.DEFAULT_MAX_RESULT_SIZE;
    // **Only a JSON body is weighed, and it is weighed as returned, which is
    // as-is.** A non-JSON body has no inline representation — it is saved for
    // what it is — and the wrap's JSON arm returns text unchanged, so the bytes
    // measured here are the bytes the model receives (ARCHITECTURE.md invariant
    // 14, `LESSONS.md` RC-15).
    const overCap = classified.json && Buffer.byteLength(content, "utf8") > maxSize;

    // **An empty body is a legitimate response, not a failed parse.** A `204`,
    // a `HEAD` or a `304` from an ordinary REST endpoint is returned as the
    // empty string rather than written as a zero-byte file the model is told to
    // read. Still saved where the caller explicitly asked for a file.
    const emptyBody = !classified.json && classified.reason === "empty-body";
    if (emptyBody && !options.saveToFile) return { content: "", savedToFile: false, ...lossy };

    // **Any other non-JSON body is always saved and never returned inline.** An
    // agent can often recover from a body that nearly parses — a PHP warning
    // prepended, an HTML error page from a proxy — so the bytes are kept and
    // the path reported; what is not returned is arbitrary remote text inline.
    //
    // **`filterApplied` is in this condition because the classification above
    // describes the ORIGINAL body, and a filter's output replaces it.** The
    // filter runs only on a body `classifyBody` accepted, so today the term
    // never changes the outcome; it states that a filter result — our own
    // serialiser's output, valid JSON by construction — is never saved for
    // being non-JSON. `LESSONS.md` RC-45.
    const shouldSave = options.saveToFile || overCap || (!classified.json && !filterApplied);

    if (shouldSave) {
        // **The artefact's form is decided by the gate, never by the declared
        // header** — `docs/todos/018` settles this, and the header is invariant
        // 1a's named failure shape precisely because a remote writes it.
        //
        // - **A JSON document is persisted as the ORIGIN'S OCTETS**, byte for
        //   byte, whatever Step 2 would have changed. Its reader is `jq_query`,
        //   which trims as `classifyBody` does, so a leading U+FEFF or Unicode
        //   space does not stop it opening the file. This is where RC-33's loss
        //   hurt: duplicate keys, integers past `Number.MAX_SAFE_INTEGER`,
        //   `"1.50"`.
        // - **A non-JSON body is persisted as the origin's octets too, unless
        //   Step 2 changed it.** `jq_query` cannot open it, so `savedMessage`
        //   routes the model to the host's own file tooling — outside every
        //   defence — and the sanitised text is what goes down where there was
        //   something to remove.
        // - **A filter's output is our own serialiser's**, so there are no
        //   origin octets to preserve.
        //
        // No strip stage runs on any arm, which is what keeps an HTML error
        // page readable: `stripHtmlComments` would delete the `<!-- trace-id -->`
        // a framework put the diagnostic in. `ARCHITECTURE.md` invariant 14.
        const diskContent = filterApplied
            ? Buffer.from(content, "utf8")
            : originOnDisk
            ? responseBytes
            : Buffer.from(sanitised, "utf8");
        const filepath = await saveResponseToFile(diskContent, options.url, options.outputDir);
        // **No body bytes are returned on this arm.** `formatResponse`'s file
        // branch emits `saved_to_file`, `filepath` and `message` and never reads
        // the body, so there is nothing here for the model to see and nothing to
        // defend.
        //
        // Returning no body bytes makes invariant 14 trivially true here rather
        // than narrowly true: the cap cannot be exceeded by bytes that are not
        // returned. `ProcessedResponse`'s saved arm carries no `content` field
        // at all, so this is enforced by the type and not by this comment.
        //
        // The body is not lost — it is on disk, and `message` below names
        // `jq_query` for a JSON artefact and the client's own tooling otherwise.
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
                // The filter arm writes the filter's output, and a changed
                // non-JSON body writes sanitised text; every other arm is the
                // origin's octets.
                originBytesExact: !filterApplied && originOnDisk,
                measuredBytes: Buffer.byteLength(content, "utf8"),
                decodeWasLossy,
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
