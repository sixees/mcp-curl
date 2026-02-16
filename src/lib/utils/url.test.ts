import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "./url.js";

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
