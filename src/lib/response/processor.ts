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
    isSniffableContentType,
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
    // (PR-6b S4) before the sanitiser strips anything, so injection
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
 */
export function defendForInline(text: string, hostname: string): string {
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
export function exceedsInlineCap(text: string, hostname: string, maxBytes: number): boolean {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) return true;
    if (bytes * MAX_INLINE_GROWTH_RATIO <= maxBytes) return false;
    return Buffer.byteLength(defendForInline(text, hostname), "utf8") > maxBytes;
}

/**
 * Process response with filtering and size handling.
 *
 * Processing pipeline (text content only):
 * 1. Early size guard (against {@link LIMITS.MAX_RESPONSE_SIZE}).
 * 2. **Sanitise + detect** (Unicode attack chars stripped; visible-space
 *    + newline padding collapsed; injection patterns logged on the
 *    pre-sanitise text per the PR-6b S4 ordering). Runs FIRST so that
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

        // Parse once - reuse for filter application
        try {
            parsedData = JSON.parse(trimmed);
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
    // What it does NOT do is rewrite the returned value. `processResponse` is a
    // published entry point whose documented behaviour is the ORIGIN's grammar —
    // a `text/plain` body keeps its comments, a JSON document keeps `<script>`
    // inside its string values (RC-10) — and the strict pass belongs to the
    // model-facing boundary, not to this one. So the defended text is computed
    // as a measurement and discarded; only the gate consumes it.
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
        // The preview is the one place the defended form is RETURNED, because
        // it is the only form that can be bounded: truncating `content` would
        // leave the wrap free to grow it back over the cap. Truncation can only
        // destroy a complete `[…](…)`, never create one, so the wrap's pass over
        // this preview finds nothing left to replace and cannot grow it.
        //
        // Byte-aware, best-effort — may produce a replacement char at the
        // boundary. No notice is written into the text: a truncation notice
        // inside remote-authored text is a control-plane fact in a data-plane
        // string and an origin can send the same words, so the fact travels in
        // the server-authored `message`. Same reasoning as `parser.ts`'s
        // `headerBytesReceived`.
        let displayContent = content;
        if (overCap) {
            displayContent = Buffer.from(defendForInline(content, hostname), "utf8")
                .subarray(0, maxSize)
                .toString("utf8");
        }
        return {
            content: displayContent,
            savedToFile: true,
            filepath,
            // Describes the artefact on disk, which is the origin-grammar copy.
            message: `Response (${Buffer.byteLength(content, "utf8")} bytes) saved to: ${filepath}`,
        };
    }

    return {
        content,
        savedToFile: false,
    };
}
