// src/lib/prompts/api-discovery.test.ts
// Security regression tests for api-discovery prompt URL scheme validation

import { describe, it, expect } from "vitest";
import { apiDiscoveryBaseUrlSchema } from "./api-discovery.js";

describe("api-discovery prompt — URL scheme allowlist", () => {
    it("rejects ftp:// URLs", () => {
        expect(apiDiscoveryBaseUrlSchema.safeParse("ftp://evil.com").success).toBe(false);
    });

    it("rejects file:// URLs", () => {
        expect(apiDiscoveryBaseUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
    });

    it("rejects javascript: URLs", () => {
        expect(apiDiscoveryBaseUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    });

    it("accepts http:// URLs", () => {
        expect(apiDiscoveryBaseUrlSchema.safeParse("http://api.example.com").success).toBe(true);
    });

    it("accepts https:// URLs", () => {
        expect(apiDiscoveryBaseUrlSchema.safeParse("https://api.example.com").success).toBe(true);
    });
});
