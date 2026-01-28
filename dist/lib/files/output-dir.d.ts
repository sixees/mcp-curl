/**
 * Resolve the output directory with priority:
 * 1) parameter (if provided)
 * 2) MCP_CURL_OUTPUT_DIR env var
 * 3) null (caller should fall back to temp directory)
 *
 * @throws Error if parameter or env var is set but empty/whitespace-only
 */
export declare function resolveOutputDir(paramDir?: string): string | null;
/**
 * Validate output directory is safe to use. Returns the real path (symlinks resolved).
 *
 * Security: We use realpath() to resolve symlinks before validation. This prevents
 * symlink-based attacks where an attacker creates a symlink pointing outside the
 * intended directory (e.g., /safe/output -> /etc). Without realpath(), we would
 * validate "/safe/output" but actually write to "/etc".
 *
 * @throws Error if directory doesn't exist, isn't a directory, or isn't writable
 */
export declare function validateOutputDir(dir: string): Promise<string>;
