// src/lib/response/parser.ts
// Parse cURL output and check content types

import { LIMITS } from "../config/limits.js";
import { parseMimeType } from "../utils/index.js";

/**
 * The type/subtype of a media type, anchored, with the parameter tail ignored.
 *
 * **This is a trust boundary, not a tidiness check.** `%{content_type}` is
 * echoed verbatim from the origin, so consumers that interpolate it are
 * composing remote-chosen text into sentences they author and the model reads
 * as this server speaking. The fix belongs on the field, because the next
 * consumer has not been written yet.
 *
 * **It matches only the head, and keeping only the head is the defence.** A
 * media type's parameter tail admits arbitrary text by design — RFC 9110 puts a
 * quoted-string in the grammar precisely so it can hold any text, and the
 * unquoted token class admits `- . _ ' * % ~ | ^`, which reads to a model as
 * prose without a single space in it. So no grammar over the tail can answer
 * *"can this carry an instruction"*, and validating the tail was work whose
 * result the caller discarded. Nothing in this tree reads a parameter: every
 * consumer passes the value through `parseMimeType`, which splits on `;` and
 * throws the tail away.
 *
 * **Matching the head rather than the whole value is what keeps a malformed
 * tail CLASSIFIABLE**, and that is the property an all-or-nothing grammar cost
 * us. Rejecting `text/html;;` outright collapsed "declared, unusable" into "not
 * declared" — and `defendText` grants the JSON exemption on that absence, so a
 * markup body could claim the exemption and take NO strip stage at all,
 * reopening the bypass `ARCHITECTURE.md` invariant 1a records as closed. Here
 * `text/html;;` yields `text/html`, the exemption is correctly denied, and
 * `undefined` regains one meaning: no parseable media type at all.
 *
 * **Linear per invariant 15 by construction, not by argument.** The match is
 * anchored at `^` and every quantifier is bounded, so the attempt is O(1) in the
 * input's length — measured flat at 0.0001–0.001 ms from 500 bytes to 131 KB,
 * including a backtrack-bait tail. No length precondition is needed to bound the
 * engine's work, because there is no unbounded region for it to scan.
 *
 * The lookahead is load-bearing: without it `text/html<script>` would match
 * `text/html` and a garbage header would be classified as HTML. Requiring a
 * parameter separator, whitespace or end-of-input after the subtype makes such a
 * value reject to `undefined`, which selects the strictest grammar.
 *
 * `LESSONS.md` RC-14, RC-31, RC-32.
 */
const MEDIA_TYPE_HEAD =
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}(?=[ \t;]|$)/;

/**
 * Parsed response with body and optional content type.
 */
export interface ParsedResponse {
    /** Response body content */
    body: string;
    /**
     * The type/subtype of a well-formed Content-Type — never its parameters.
     *
     * `application/json; charset=utf-8` arrives here as `application/json`.
     * The parameter tail is discarded after matching because it is the one
     * region of the grammar that may hold arbitrary remote text, and no
     * consumer in this tree reads it.
     *
     * Absent both where the origin sent none and where what it sent is not a
     * media type — see `MEDIA_TYPE_HEAD`. The two collapse deliberately:
     * both mean "no usable declared grammar", and both must select the
     * strictest one downstream. **That is a claim about a consumer, so it is
     * enforced at one** — `defendText` tests this field for `undefined`
     * alongside `contentTypeUndetermined`, because the two absences are keyed
     * on different facts and only the flag was consulted. `LESSONS.md` RC-31.
     */
    contentType?: string;
    /**
     * Whether the `-w` metadata block was located at all.
     *
     * **Distinct from `contentType === undefined`**, and the distinction is
     * load-bearing: "the origin sent no Content-Type" and "we could not find
     * our own metadata" must not select the same defences. The second means
     * every cURL-authored field is missing, so the strictest grammar applies —
     * see `defendText`'s `contentTypeUndetermined`.
     */
    metadataFound: boolean;
}

/**
 * Check if a content-type indicates JSON response.
 *
 * Matches:
 * - application/json
 * - Any content type ending with +json (e.g., application/vnd.api+json)
 *
 * @param contentType - The Content-Type header value
 * @returns true if the content type indicates JSON
 */
export function isJsonContentType(contentType: string | undefined): boolean {
    const mime = parseMimeType(contentType);
    return mime === "application/json" || mime.endsWith("+json");
}

/**
 * Parse cURL response to extract body and content-type.
 *
 * The separator must be the same unique value used in the -w format string.
 * As a defence-in-depth measure the search covers only the tail of the
 * response — the separator's own length plus MAX_METADATA_TAIL_LENGTH for the
 * fields, never a flat budget the two share (see the window below). The unique
 * per-request separator is the primary protection against injection.
 *
 * The metadata block is `<separator><content_type>`. `%{content_type}` is
 * echoed from the remote and may contain anything, which is safe only because
 * it is the block's whole content: there is no field beside it to shift and no
 * trailing delimiter to spoof, and the separator ahead of it is unguessable per
 * request. A second field would end that, so a new field goes BEFORE the
 * content type, never after it — `ARCHITECTURE.md` invariant 13 states the rule
 * and `curl-args-builder.ts` is the writing half of it.
 *
 * Returns the body as a string only. Nothing indexes a wire byte count into
 * this response — the header/body split is structural, not derived — so no
 * octet copy is returned beside it: a spare Buffer whose doc-block says
 * "measure with these" but which nothing measures reads as a guarantee in
 * force.
 *
 * **The decode is lossy and currently unavoidable downstream.** A byte that is
 * not valid UTF-8 becomes U+FFFD here, and `saveResponseToFile` takes a
 * `string`, so the persisted artefact carries the replacement rather than the
 * wire byte — and `processResponse` reports the decoded length as the response
 * size. Restoring octet fidelity is not a matter of reading them off this
 * function: it needs `saveResponseToFile`'s signature and `processResponse`'s
 * return type to change with it. Said plainly here so the next reader does not
 * discover it halfway through.
 *
 * @param rawResponse - The raw response from cURL including metadata suffix
 * @param separator - The unique per-request separator used in -w format
 * @returns ParsedResponse with the decoded body and the optional contentType
 */
export function parseResponseWithMetadata(
    rawResponse: Buffer,
    separator: string
): ParsedResponse {
    // Buffer only, deliberately. A `string | Buffer` union would leave the
    // lossy arm — the one RC-2 is about — one character away at every call
    // site, with no compiler objection. Tests convert at the call site instead.
    const raw = rawResponse;
    const sep = Buffer.from(separator, "utf8");

    // The window is the separator's own length PLUS the field allowance, not a
    // flat constant the two share. One shared budget lets a long, entirely
    // legal, remote-chosen Content-Type push the separator out of the window —
    // at which point the block reads as absent and the response falls back to
    // the strictest grammar on a perfectly ordinary reply. The measured case is
    // in LIMITS.MAX_METADATA_TAIL_LENGTH, which owns the sizing.
    const windowBytes = sep.length + LIMITS.MAX_METADATA_TAIL_LENGTH;
    const searchStart = Math.max(0, raw.length - windowBytes);
    // Search only the window, so the scan stays bounded rather than walking a
    // 10MB body to find something that can only ever be at the end.
    const indexInWindow = raw.subarray(searchStart).lastIndexOf(sep);
    const separatorIndex = indexInWindow === -1 ? -1 : searchStart + indexInWindow;

    if (separatorIndex === -1) {
        return {
            body: raw.toString("utf8"),
            metadataFound: false,
        };
    }

    const bodyBytes = raw.subarray(0, separatorIndex);
    const metadata = raw.subarray(separatorIndex + sep.length).toString("utf8");

    // The whole block is %{content_type}. An empty one stays undefined rather
    // than becoming "", so "the origin sent no Content-Type" keeps selecting the
    // strictest grammar downstream instead of a falsy value nobody checks.
    //
    // A value failing MEDIA_TYPE_HEAD resolves to the SAME undefined, and
    // that is the whole defence: the origin writes these bytes, and downstream
    // every consumer composes them into a sentence it authors in its own voice.
    // Constraining the field here means it cannot carry prose at any consumer,
    // present or future — where fixing each composition site leaves the next
    // one to be written wrong. A header this rejects was never usable as a
    // media type, so nothing diagnostic is lost.
    const contentType = metadata.trim();
    // Keep the matched head and nothing else. The match proves there is a media
    // type here; discarding the tail is what stops the field carrying prose,
    // because the tail is the only region of the grammar that admits it and
    // every consumer throws it away regardless (`parseMimeType`).
    const validContentType = MEDIA_TYPE_HEAD.exec(contentType)?.[0];

    return {
        body: bodyBytes.toString("utf8"),
        contentType: validContentType,
        metadataFound: true,
    };
}

/**
 * Sanitize error messages to prevent information disclosure.
 *
 * When includeDetails is false:
 * - Removes response previews (could contain sensitive API data)
 * - Removes file paths (could leak system information)
 * - Adds hint about getting more details with include_metadata
 *
 * @param message - The raw error message
 * @param includeDetails - If true, return message unchanged
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(message: string, includeDetails: boolean): string {
    if (includeDetails) {
        return message;
    }
    // Remove response previews (could contain sensitive API data)
    let sanitized = message.replace(/\nPreview:[\s\S]*$/, "");
    // Remove filesystem paths - handles both Unix (/path/to/file) and Windows (C:\path\to\file)
    // Requires at least two path segments, so a bare "/users" is left alone — a
    // two-segment path such as "/v1/users" still matches and is replaced.
    sanitized = sanitized.replace(/(?:\/(?:[^\s/:]+\/)+[^\s/:]+|[A-Za-z]:\\[^\s:]+)/g, "[PATH]");
    // Add hint about getting more details
    if (sanitized !== message) {
        sanitized += " (use include_metadata: true for details)";
    }
    return sanitized;
}
