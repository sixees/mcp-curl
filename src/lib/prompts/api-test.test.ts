// src/lib/prompts/api-test.test.ts
// Security regression tests for api-test prompt URL scheme validation

import { describe, it, expect } from "vitest";
import { apiTestUrlSchema } from "./api-test.js";

describe("api-test prompt — URL scheme allowlist", () => {
    it("rejects ftp:// URLs", () => {
        expect(apiTestUrlSchema.safeParse("ftp://evil.com").success).toBe(false);
    });

    it("rejects file:// URLs", () => {
        expect(apiTestUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
    });

    it("rejects javascript: URLs", () => {
        expect(apiTestUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    });

    it("accepts http:// URLs", () => {
        expect(apiTestUrlSchema.safeParse("http://api.example.com").success).toBe(true);
    });

    it("accepts https:// URLs", () => {
        expect(apiTestUrlSchema.safeParse("https://api.example.com").success).toBe(true);
    });
});
