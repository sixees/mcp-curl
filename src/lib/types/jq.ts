// src/lib/types/jq.ts

/**
 * Token types for jq filter parsing.
 */
export type JqToken =
    | { type: "key"; value: string }
    | { type: "index"; value: number }
    | { type: "slice"; start?: number; end?: number }
    | { type: "iterate" };
