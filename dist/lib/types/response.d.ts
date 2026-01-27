/**
 * Result of URL validation including resolved IP for DNS pinning.
 */
export interface UrlValidationResult {
    hostname: string;
    port: number;
    resolvedIp: string;
}
/**
 * Options for processing HTTP responses.
 */
export interface ProcessResponseOptions {
    url: string;
    jqFilter?: string;
    maxResultSize?: number;
    saveToFile?: boolean;
    contentType?: string;
    outputDir?: string;
}
/**
 * Result of response processing.
 */
export interface ProcessedResponse {
    content: string;
    savedToFile: boolean;
    filepath?: string;
    message?: string;
}
