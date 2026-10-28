// src/lib/types/response.ts

/**
 * Result of URL validation including resolved IP for DNS pinning.
 * DNS pinning prevents rebinding attacks where DNS returns a safe IP initially
 * then switches to an internal IP on subsequent lookups.
 */
export interface UrlValidationResult {
    /** Validated hostname from the URL */
    hostname: string;
    /** Port number (1-65535) */
    port: number;
    /** DNS-resolved IP address, pinned to cURL via --resolve flag */
    resolvedIp: string;
}

/**
 * Options for processing HTTP responses.
 */
export interface ProcessResponseOptions {
    /** Original request URL (used for generating safe filenames) */
    url: string;
    /** Optional jq-like filter to extract specific data from JSON responses */
    jqFilter?: string;
    /** Maximum result size in bytes before auto-saving to file (default: 500KB) */
    maxResultSize?: number;
    /** Force saving response to file regardless of size */
    saveToFile?: boolean;
    /**
     * The response's media type as **type/subtype only** — never its parameters.
     *
     * `parseResponseWithMetadata` is the producer and
     * `ParsedResponse.contentType` owns the reason. `processResponse` does not
     * read it: the artefact's form and the saved-file message are decided by
     * `classifyBody`, never by the declared header, so no model-facing sentence
     * carries it. Keep it type/subtype only regardless — a raw header here is a
     * remote-authored channel waiting for its first reader (`LESSONS.md` RC-30).
     */
    contentType?: string;
    /**
     * True when the content type could not be DETERMINED — the `-w` metadata
     * block was not located — as distinct from the origin sending none.
     *
     * `processResponse` reads it as "the end of the body is unknown", so a
     * saved file is never described as the origin's exact bytes. Omitted reads
     * as located: a library caller passing its own body knows where it ends.
     * `defendText` takes a flag of the same name on its own options, where it
     * selects the strictest grammar; this one does not reach it.
     */
    contentTypeUndetermined?: boolean;
    /**
     * Directory for saving large responses (default: temp dir).
     *
     * **Must arrive already validated** — resolved, symlinks followed, and
     * checked against the allowed roots. `processResponse` passes it straight to
     * `saveResponseToFile`, whose own `realpath` comparison resolves the path
     * against itself and so checks nothing here — this type is the last place
     * the policy can be stated before the write. The
     * validation lives at `tools/curl-execute.ts::executeCurlRequest`
     * (`resolveOutputDir` then `validateOutputDir`).
     */
    outputDir?: string;
}

/**
 * Result of response processing - uses discriminated union to enforce
 * that filepath is present if and only if savedToFile is true.
 *
 * **`content` exists on the inline arm only, and its absence from the saved arm
 * is invariant 14 stated in the type rather than in prose.** The saved arm
 * carries no body bytes because none are returnable: the body on that path is
 * the whole response, unbounded by `max_result_size` — that is what put it in a
 * file — and it has had no inline defence pass, because the pass would be over
 * bytes no consumer may emit. A `content: string` here would be indistinguishable
 * from the inline arm's at the call site while meaning the opposite, and the
 * first caller to read it would breach the byte ceiling with nothing erroring.
 *
 * The body reaches the model through {@link ProcessedResponse.filepath}. For a
 * JSON artefact that route is `jq_query`, which applies its own defence and its
 * own cap to whatever it extracts. **For any other grammar there is no such
 * route** — the model reads the path with its own tooling, which applies
 * neither, so the *byte-ceiling* half of this justification holds on every arm
 * and the *defence* half holds only on the JSON one. Stated rather than implied
 * because a reader checking invariant 1 against this type would otherwise
 * conclude the saved path is covered for `text/html`, and it is not.
 */
export type ProcessedResponse =
    | {
          /** Processed response content (may be filtered via jq) */
          content: string;
          /** Response was returned inline, not saved to file */
          savedToFile: false;
          /** Optional informational message */
          message?: string;
          /**
           * True when the UTF-8 decode of the wire octets was lossy — the
           * origin sent bytes that are not valid UTF-8, and each bad sequence
           * became U+FFFD before anything else ran.
           *
           * **Reported rather than corrected, because it cannot be corrected
           * here.** The body still parses as JSON and its structure is intact;
           * one or more character values are not what the origin sent. Absent
           * means the decode round-tripped exactly.
           */
          decodeWasLossy?: true;
      }
    | {
          /** Response was saved to file (exceeded size limit or forced) */
          savedToFile: true;
          /** Absolute path to the saved file */
          filepath: string;
          /** Optional informational message */
          message?: string;
          /** @see the inline arm's `decodeWasLossy` */
          decodeWasLossy?: true;
      };
