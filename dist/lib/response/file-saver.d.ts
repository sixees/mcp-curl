/**
 * Create a safe filename base from arbitrary input.
 *
 * Security features:
 * - Replaces non-alphanumeric characters with underscores
 * - Trims leading/trailing underscores
 * - Enforces maximum length
 * - Avoids Windows reserved names and special paths
 *
 * @param input - The input string to convert to a safe filename
 * @param fallback - Fallback name if input produces empty result (default: "response")
 * @returns A safe filename base (without extension)
 */
export declare function createSafeFilenameBase(input: string, fallback?: string): string;
/**
 * Save response content to a file.
 *
 * Uses custom output directory if provided, otherwise uses temp directory.
 * Creates a safe filename from the URL and adds a timestamp for uniqueness.
 * File is written with mode 0o600 (owner-only access).
 *
 * @param content - The content to save
 * @param url - The request URL (used for generating filename)
 * @param outputDir - Optional output directory (must already be validated)
 * @returns Absolute path to the saved file
 */
export declare function saveResponseToFile(content: string, url: string, outputDir?: string): Promise<string>;
