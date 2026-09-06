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
    /** Content-Type header from response (used to detect JSON) */
    contentType?: string;
    /**
     * True when the content type could not be DETERMINED — the `-w` metadata
     * block was not located — as distinct from the origin sending none.
     *
     * Selects the strictest grammar in `defendText`, so that losing our own
     * metadata can never be a way to switch a strip stage off.
     */
    contentTypeUndetermined?: boolean;
    /** Directory for saving large responses (default: temp dir) */
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
 * The body reaches the model through {@link ProcessedResponse.filepath} and the
 * `jq_query` tool, which applies its own defence and its own cap to whatever it
 * extracts.
 */
export type ProcessedResponse =
    | {
          /** Processed response content (may be filtered via jq) */
          content: string;
          /** Response was returned inline, not saved to file */
          savedToFile: false;
          /** Optional informational message */
          message?: string;
      }
    | {
          /** Response was saved to file (exceeded size limit or forced) */
          savedToFile: true;
          /** Absolute path to the saved file */
          filepath: string;
          /** Optional informational message */
          message?: string;
      };
