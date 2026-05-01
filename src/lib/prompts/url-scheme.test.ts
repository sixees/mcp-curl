// src/lib/prompts/url-scheme.test.ts
// Parameterised regression suite locking the http/https scheme allowlist at
// every prompt URL boundary. Both prompt schemas wire through the same
// `createHttpOnlyUrlSchema` helper — these tests catch the case where a
// future contributor swaps one schema for `z.url()` (or relaxes the helper
// for one consumer) without touching the helper-level tests in
// `src/lib/utils/url.test.ts`.

import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { apiDiscoveryBaseUrlSchema } from "./api-discovery.js";
import { apiTestUrlSchema } from "./api-test.js";

const PROMPT_SCHEMAS: ReadonlyArray<{ name: string; schema: z.ZodType<string> }> = [
    { name: "api-discovery base URL", schema: apiDiscoveryBaseUrlSchema },
    { name: "api-test endpoint URL", schema: apiTestUrlSchema },
];

const REJECTED_URLS: ReadonlyArray<{ label: string; url: string }> = [
    { label: "ftp://", url: "ftp://evil.com" },
    { label: "file://", url: "file:///etc/passwd" },
    { label: "javascript:", url: "javascript:alert(1)" },
    { label: "data:", url: "data:text/plain;base64,SGVsbG8=" },
    { label: "vbscript:", url: "vbscript:msgbox(1)" },
];

const ACCEPTED_URLS: ReadonlyArray<{ label: string; url: string }> = [
    { label: "http", url: "http://api.example.com" },
    { label: "https", url: "https://api.example.com" },
];

describe.each(PROMPT_SCHEMAS)("$name — URL scheme allowlist", ({ schema }) => {
    it.each(REJECTED_URLS)("rejects $label URLs", ({ url }) => {
        expect(schema.safeParse(url).success).toBe(false);
    });

    it.each(ACCEPTED_URLS)("accepts $label URLs", ({ url }) => {
        expect(schema.safeParse(url).success).toBe(true);
    });
});
