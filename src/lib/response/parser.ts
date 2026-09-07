// src/lib/response/parser.ts
// Parse cURL output and check content types

import { LIMITS } from "../config/limits.js";
import { parseMimeType } from "../utils/index.js";

/**
 * The longest `%{content_type}` this will even attempt to match.
 *
 * **A structural bound on the regex's input, not a guess at what origins
 * send.** `MAX_METADATA_TAIL_LENGTH` is 8,192, and a bound argued from reading
 * the pattern is only as good as the next edit to it — so the work the engine
 * can be asked to do is capped here, where no change to the grammar below can
 * widen it. 1 KB is roughly 4x the longest value the grammar can produce once
 * the tail is discarded, and comfortably admits a real `profile="<uri>"`.
 * `LESSONS.md` RC-31.
 */
const MEDIA_TYPE_MAX_LENGTH = 1024;

/**
 * RFC 6838 media type, with an optional parameter tail.
 *
 * **This is a trust boundary, not a tidiness check.** `%{content_type}` is
 * echoed verbatim from the origin, so without this the field is a
 * remote-chosen string that consumers go on to interpolate into sentences THEY
 * author and the model reads as this server speaking. The fix belongs on the
 * field rather than on each sentence, because the next consumer has not been
 * written yet.
 *
 * **Matching is the whole of the check, and it is NOT the whole of the
 * defence.** A media type's parameter tail admits arbitrary text by design —
 * RFC 9110 puts a quoted-string in the grammar precisely so it can hold any
 * text, and the unquoted token class admits `- . _ ' * % ~ | ^`, which reads
 * to a model as prose without a single space in it. So a grammar check can
 * answer *"is this syntactically a media type"* and can never answer *"can
 * this carry an instruction"*. **What closes that channel is the projection at
 * the call site**: only the type/subtype is kept, and the parameter tail is
 * discarded after matching. Nothing in this tree reads a parameter — every
 * consumer passes the value through `parseMimeType`, which splits on `;` and
 * throws the tail away — so the projection costs no information and leaves the
 * field a bounded token with no space-bearing region at all.
 *
 * An earlier revision of this doc-block claimed the residual was "bounded at
 * 512 characters … a 16x reduction". **That was wrong by roughly 15x**: the
 * parameter group repeats `{0,32}`, so the real bound was the whole 8,192-byte
 * metadata window, and a decline elsewhere had been priced against the smaller
 * figure. Measured: a 32-parameter value carried 7,680 characters of free-form
 * prose past this pattern intact.
 *
 * Linear per invariant 15, and the previous claim of linearity was also
 * wrong. Every quantifier is bounded, but that is not sufficient: two
 * quantified runs over the SAME alphabet separated only by an optional element
 * at an anchor make the engine rescan a failing suffix once per starting
 * offset. The tail was `[ \t]*;?[ \t]*$`, which is exactly that shape —
 * measured quadratic at 0.71 ms for 500 trailing spaces rising to 39.4 ms at
 * 8,000, and up to 122.8 ms on other shapes at the cap, on the thread serving
 * every session. It is now one group, `(?:[ \t]*;)?[ \t]*$`, so no two
 * whitespace runs are ever adjacent: 0.033 ms at the cap, flat across sizes.
 *
 * **The rule that finds this shape, since bounded-quantifier counting did
 * not:** for every repeated character class, name every token the match must
 * still consume after it, and check the class against all of them.
 * `LESSONS.md` RC-14, RC-31.
 */
const MEDIA_TYPE_PATTERN =
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}(?:[ \t]*;[ \t]*[A-Za-z0-9!#$&^_.+`|~*%'-]{1,64}=(?:[A-Za-z0-9!#$&^_.+`|~*%'-]{1,256}|"[^"\\\x00-\x1f]{0,512}")){0,32}(?:[ \t]*;)?[ \t]*$/;

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
     * media type — see `MEDIA_TYPE_PATTERN`. The two collapse deliberately:
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
    // A value failing MEDIA_TYPE_PATTERN resolves to the SAME undefined, and
    // that is the whole defence: the origin writes these bytes, and downstream
    // every consumer composes them into a sentence it authors in its own voice.
    // Constraining the field here means it cannot carry prose at any consumer,
    // present or future — where fixing each composition site leaves the next
    // one to be written wrong. A header this rejects was never usable as a
    // media type, so nothing diagnostic is lost.
    const contentType = metadata.trim();
    // Bound the regex's input before matching, then keep ONLY the type/subtype.
    // The match proves the value is a media type; the projection is what stops
    // it carrying prose, because the parameter tail is where the grammar allows
    // prose and every consumer discards it anyway (`parseMimeType`).
    const validContentType =
        contentType.length <= MEDIA_TYPE_MAX_LENGTH && MEDIA_TYPE_PATTERN.test(contentType)
            ? contentType.split(";")[0].trim()
            : undefined;

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
