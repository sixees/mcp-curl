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
    /** Directory for saving large responses (default: temp dir) */
    outputDir?: string;
}

/**
 * Result of response processing - uses discriminated union to enforce
 * that filepath is present if and only if savedToFile is true.
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
          /** Processed response content (may be filtered via jq) */
          content: string;
          /** Response was saved to file (exceeded size limit or forced) */
          savedToFile: true;
          /** Absolute path to the saved file */
          filepath: string;
          /** Optional informational message */
          message?: string;
      };
