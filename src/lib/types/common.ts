// src/lib/types/common.ts
import { randomUUID } from "crypto";
import { WRITE_OUT_HEADER_NAME } from "../config/security/validation.js";

/**
 * Generate unique separator per request to prevent response injection attacks.
 * An attacker could craft a response containing our separator to inject fake metadata.
 */
export function generateMetadataSeparator(): string {
    return `\n---MCP-CURL-${randomUUID()}---\n`;
}

/**
 * One request's `-w` metadata block: the separator, and whether the block
 * carries the rate-limit sync header.
 *
 * **One value, handed to both `buildCurlArgs` and `parseResponseWithMetadata`**,
 * because the separator count a well-formed block holds depends on it. Two
 * inputs that had to agree would compile when they did not, and every response
 * would then parse as undetermined.
 */
export interface MetadataBlock {
    readonly separator: string;
    /** Response header whose value rides the block as its own field. */
    readonly syncHeaderName?: string;
}

/**
 * The block's cURL write-out directives, in order. The writer emits these and
 * the reader counts them, so this is the only statement of the layout
 * (`ARCHITECTURE.md` invariant 13).
 *
 * @throws when `syncHeaderName` is not a {@link WRITE_OUT_HEADER_NAME}
 */
export function metadataDirectives(block: MetadataBlock): string[] {
    const { syncHeaderName } = block;
    if (syncHeaderName === undefined) {
        return ["%{http_code}", "%{redirect_url}", "%{content_type}"];
    }
    if (!WRITE_OUT_HEADER_NAME.test(syncHeaderName)) {
        throw new Error("Invalid sync header name: must be an HTTP field name (RFC 9110 token) without %.");
    }
    return ["%{http_code}", "%{redirect_url}", `%header{${syncHeaderName}}`, "%{content_type}"];
}
