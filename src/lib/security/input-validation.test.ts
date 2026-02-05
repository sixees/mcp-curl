// src/lib/security/input-validation.test.ts
// Tests for input validation utilities

import { describe, it, expect } from "vitest";
import { safeStringCompare, validateNoCRLF, isValidSessionId } from "./input-validation.js";

describe("safeStringCompare", () => {
    it("returns true for identical strings", () => {
        expect(safeStringCompare("test", "test")).toBe(true);
        expect(safeStringCompare("Bearer token123", "Bearer token123")).toBe(true);
    });

    it("returns false for different strings", () => {
        expect(safeStringCompare("test", "test2")).toBe(false);
        expect(safeStringCompare("Bearer token123", "Bearer token456")).toBe(false);
    });

    it("returns false for different length strings", () => {
        expect(safeStringCompare("short", "longer-string")).toBe(false);
        expect(safeStringCompare("a", "ab")).toBe(false);
    });

    it("handles empty strings", () => {
        expect(safeStringCompare("", "")).toBe(true);
        expect(safeStringCompare("", "non-empty")).toBe(false);
    });

    it("handles unicode strings", () => {
        expect(safeStringCompare("café", "café")).toBe(true);
        expect(safeStringCompare("café", "cafe")).toBe(false);
    });
});

describe("validateNoCRLF", () => {
    it("accepts clean strings", () => {
        expect(() => validateNoCRLF("normal string", "test")).not.toThrow();
        expect(() => validateNoCRLF("with spaces and punctuation!", "test")).not.toThrow();
    });

    it("rejects strings with CR", () => {
        expect(() => validateNoCRLF("bad\rstring", "test")).toThrow("forbidden characters");
    });

    it("rejects strings with LF", () => {
        expect(() => validateNoCRLF("bad\nstring", "test")).toThrow("forbidden characters");
    });

    it("rejects strings with CRLF", () => {
        expect(() => validateNoCRLF("bad\r\nstring", "test")).toThrow("forbidden characters");
    });

    it("rejects strings with null byte", () => {
        expect(() => validateNoCRLF("bad\0string", "test")).toThrow("forbidden characters");
    });

    it("includes field name in error message", () => {
        expect(() => validateNoCRLF("bad\nstring", "header value")).toThrow("header value");
    });
});

describe("isValidSessionId", () => {
    it("accepts valid UUID v4 format", () => {
        // Valid v4 UUID: version=4 (4th group starts with 4), variant=8/9/a/b (5th group starts with 8/9/a/b)
        expect(isValidSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
        expect(isValidSessionId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    });

    it("accepts UUID v4 with uppercase letters", () => {
        expect(isValidSessionId("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    });

    it("rejects invalid UUID v4 (wrong version)", () => {
        // Version 1 UUID (starts with 1 in 3rd group) - should fail v4 check
        expect(isValidSessionId("550e8400-e29b-11d4-a716-446655440000")).toBe(false);
    });

    it("rejects invalid UUID v4 (wrong variant)", () => {
        // Variant 0 (5th group starts with 0) - should fail v4 check
        expect(isValidSessionId("550e8400-e29b-41d4-0716-446655440000")).toBe(false);
    });

    it("rejects undefined", () => {
        expect(isValidSessionId(undefined)).toBe(false);
    });

    it("rejects empty string", () => {
        expect(isValidSessionId("")).toBe(false);
    });

    it("rejects malformed UUIDs", () => {
        expect(isValidSessionId("not-a-uuid")).toBe(false);
        expect(isValidSessionId("550e8400e29b41d4a716446655440000")).toBe(false); // missing dashes
    });
});
