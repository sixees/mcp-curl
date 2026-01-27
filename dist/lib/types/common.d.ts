/**
 * Generate unique separator per request to prevent response injection attacks.
 * An attacker could craft a response containing our separator to inject fake metadata.
 */
export declare function generateMetadataSeparator(): string;
