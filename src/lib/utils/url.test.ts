import { describe, it, expect } from "vitest";
import { resolveBaseUrl, safeHostname } from "./url.js";

describe("resolveBaseUrl", () => {
    it("strips trailing slash from base and joins with path", () => {
        expect(resolveBaseUrl("https://api.example.com/", "/users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("handles base without trailing slash", () => {
        expect(resolveBaseUrl("https://api.example.com", "/users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("adds leading slash to path if missing", () => {
        expect(resolveBaseUrl("https://api.example.com", "users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("handles base with trailing slash and path without leading slash", () => {
        expect(resolveBaseUrl("https://api.example.com/", "users")).toBe(
            "https://api.example.com/users"
        );
    });

    it("preserves path with query params", () => {
        expect(resolveBaseUrl("https://api.example.com", "/search?q=test")).toBe(
            "https://api.example.com/search?q=test"
        );
    });

    it("handles nested base paths", () => {
        expect(resolveBaseUrl("https://api.example.com/v2/", "/users")).toBe(
            "https://api.example.com/v2/users"
        );
    });

    it("handles empty path", () => {
        expect(resolveBaseUrl("https://api.example.com", "/")).toBe(
            "https://api.example.com/"
        );
    });
});

describe("safeHostname", () => {
    it("returns hostname for a valid URL", () => {
        expect(safeHostname("https://api.example.com/foo/bar")).toBe("api.example.com");
    });

    it("returns hostname stripped of port", () => {
        expect(safeHostname("https://api.example.com:8443/foo")).toBe("api.example.com");
    });

    it("returns default fallback for malformed URL", () => {
        expect(safeHostname("not-a-url")).toBe("unknown");
    });

    it("returns default fallback for undefined", () => {
        expect(safeHostname(undefined)).toBe("unknown");
    });

    it("returns default fallback for empty string", () => {
        expect(safeHostname("")).toBe("unknown");
    });

    it("returns custom fallback when provided", () => {
        expect(safeHostname("not-a-url", "no-host")).toBe("no-host");
        expect(safeHostname(undefined, "no-host")).toBe("no-host");
    });

    it("does not throw for inputs WHATWG URL would reject", () => {
        // Each call must return the fallback rather than propagate a TypeError.
        expect(() => safeHostname("javascript:alert(1)")).not.toThrow();
        expect(() => safeHostname("://broken")).not.toThrow();
    });
});
