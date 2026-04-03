// src/lib/server/schemas.test.ts
// Security regression tests for CurlExecuteSchema URL validation (Zod v4)

import { describe, it, expect } from "vitest";
import { CurlExecuteSchema } from "./schemas.js";

describe("CurlExecuteSchema — URL scheme allowlist", () => {
    it("rejects ftp:// URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "ftp://evil.com" });
        expect(result.success).toBe(false);
    });

    it("rejects file:// URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "file:///etc/passwd" });
        expect(result.success).toBe(false);
    });

    it("rejects data: URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "data:text/html,<script>" });
        expect(result.success).toBe(false);
    });

    it("rejects javascript: URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "javascript:alert(1)" });
        expect(result.success).toBe(false);
    });

    it("accepts http:// URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "http://example.com" });
        expect(result.success).toBe(true);
    });

    it("accepts https:// URLs", () => {
        const result = CurlExecuteSchema.safeParse({ url: "https://example.com" });
        expect(result.success).toBe(true);
    });
});

describe("CurlExecuteSchema — boolean defaults (Zod v4 .default() parity)", () => {
    // CURL_EXECUTE_TOOL_META.inputSchema = CurlExecuteSchema, so the MCP SDK calls
    // CurlExecuteSchema.parse(rawInput) before invoking the handler. Testing parse
    // here is equivalent to testing the registered tool handler path.
    it("applies insecure: false default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.insecure).toBe(false);
    });

    it("applies follow_redirects: true default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.follow_redirects).toBe(true);
    });

    it("applies verbose: false default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.verbose).toBe(false);
    });

    it("applies compressed: true default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.compressed).toBe(true);
    });

    it("applies include_headers: false default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.include_headers).toBe(false);
    });

    it("applies include_metadata: false default when not provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com" });
        expect(result.include_metadata).toBe(false);
    });

    it("preserves explicit insecure: true when provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com", insecure: true });
        expect(result.insecure).toBe(true);
    });

    it("preserves explicit follow_redirects: false when provided", () => {
        const result = CurlExecuteSchema.parse({ url: "https://example.com", follow_redirects: false });
        expect(result.follow_redirects).toBe(false);
    });
});

describe("CurlExecuteSchema — headers and form field validation", () => {
    it("accepts string-valued headers", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects numeric header values", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            headers: { "X-Count": 42 },
        });
        expect(result.success).toBe(false);
    });

    it("rejects array header values", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            headers: { "X-Values": ["a", "b"] },
        });
        expect(result.success).toBe(false);
    });

    it("accepts string-valued form fields", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            form: { username: "alice", token: "abc123" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects numeric form values", () => {
        const result = CurlExecuteSchema.safeParse({
            url: "https://example.com",
            form: { count: 3 },
        });
        expect(result.success).toBe(false);
    });
});
