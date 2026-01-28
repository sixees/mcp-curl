/**
 * Clear the allowed directories cache.
 * Exposed for testing purposes only.
 *
 * @internal
 */
export declare function clearAllowedDirsCache(): void;
/**
 * Validate a file path for jq_query tool (security: restrict to allowed directories).
 *
 * Security: We use realpath() to resolve symlinks before checking directory containment.
 * This prevents symlink escape attacks where an attacker creates a symlink in an allowed
 * directory that points outside it. For example:
 *   - Allowed directory: /home/user/project (cwd)
 *   - Attacker creates: /home/user/project/data.json -> /etc/passwd
 *   - Without realpath(): "/home/user/project/data.json" passes containment check
 *   - With realpath(): Resolves to "/etc/passwd", which fails containment check
 *
 * We also resolve allowed directories via realpath() for consistency, in case cwd or
 * MCP_CURL_OUTPUT_DIR are themselves symlinks.
 *
 * @throws Error if file doesn't exist, is too large, isn't readable, or is outside allowed directories
 */
export declare function validateFilePath(filepath: string): Promise<void>;
