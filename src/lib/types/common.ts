// src/lib/types/common.ts
import { randomUUID } from "crypto";

/**
 * Generate unique separator per request to prevent response injection attacks.
 * An attacker could craft a response containing our separator to inject fake metadata.
 */
export function generateMetadataSeparator(): string {
    return `\n---MCP-CURL-${randomUUID()}---\n`;
}
