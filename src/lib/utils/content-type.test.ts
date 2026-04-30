import { describe, it, expect } from "vitest";
import { isBinaryContentType, parseMimeType } from "./content-type.js";

describe("parseMimeType", () => {
    it("returns empty string for undefined", () => {
        expect(parseMimeType(undefined)).toBe("");
    });

    it("returns empty string for empty input", () => {
        expect(parseMimeType("")).toBe("");
    });

    it("lowercases the MIME type", () => {
        expect(parseMimeType("APPLICATION/JSON")).toBe("application/json");
    });

    it("strips parameters", () => {
        expect(parseMimeType("text/html; charset=utf-8")).toBe("text/html");
    });

    it("trims whitespace around the MIME", () => {
        expect(parseMimeType("  text/plain  ; charset=utf-8")).toBe("text/plain");
    });

    it("handles multiple parameters", () => {
        expect(parseMimeType("multipart/form-data; boundary=foo; charset=utf-8"))
            .toBe("multipart/form-data");
    });

    it("returns empty string for whitespace-only input", () => {
        expect(parseMimeType("   ")).toBe("");
    });
});

describe("isBinaryContentType", () => {
    it("returns false for undefined", () => {
        expect(isBinaryContentType(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(isBinaryContentType("")).toBe(false);
    });

    it("returns false for text content types", () => {
        expect(isBinaryContentType("text/plain")).toBe(false);
        expect(isBinaryContentType("text/html")).toBe(false);
        expect(isBinaryContentType("application/json")).toBe(false);
        expect(isBinaryContentType("application/xml")).toBe(false);
        expect(isBinaryContentType("application/javascript")).toBe(false);
    });

    it("returns true for image MIME types", () => {
        expect(isBinaryContentType("image/png")).toBe(true);
        expect(isBinaryContentType("image/jpeg")).toBe(true);
        expect(isBinaryContentType("image/svg+xml")).toBe(true);
    });

    it("returns true for audio/video/font MIME types", () => {
        expect(isBinaryContentType("audio/mpeg")).toBe(true);
        expect(isBinaryContentType("video/mp4")).toBe(true);
        expect(isBinaryContentType("font/woff2")).toBe(true);
    });

    it("returns true for multipart MIME types", () => {
        expect(isBinaryContentType("multipart/form-data; boundary=----abc")).toBe(true);
    });

    it("returns true for known binary application types", () => {
        expect(isBinaryContentType("application/octet-stream")).toBe(true);
        expect(isBinaryContentType("application/pdf")).toBe(true);
        expect(isBinaryContentType("application/wasm")).toBe(true);
        expect(isBinaryContentType("application/zip")).toBe(true);
        expect(isBinaryContentType("application/gzip")).toBe(true);
        expect(isBinaryContentType("application/x-gzip")).toBe(true);
        expect(isBinaryContentType("application/x-tar")).toBe(true);
    });

    it("returns true for additional binary application types", () => {
        expect(isBinaryContentType("application/x-bzip2")).toBe(true);
        expect(isBinaryContentType("application/x-7z-compressed")).toBe(true);
        expect(isBinaryContentType("application/x-rar-compressed")).toBe(true);
        expect(isBinaryContentType("application/protobuf")).toBe(true);
        expect(isBinaryContentType("application/x-protobuf")).toBe(true);
        expect(isBinaryContentType("application/x-msgpack")).toBe(true);
        expect(isBinaryContentType("application/cbor")).toBe(true);
    });

    it("returns true for Microsoft Office MIME types", () => {
        expect(isBinaryContentType("application/vnd.ms-excel")).toBe(true);
        expect(isBinaryContentType(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(isBinaryContentType("IMAGE/PNG")).toBe(true);
        expect(isBinaryContentType("Application/Pdf")).toBe(true);
    });

    it("strips parameters before classifying", () => {
        expect(isBinaryContentType("application/pdf; qs=0.9")).toBe(true);
        expect(isBinaryContentType("text/html; charset=utf-8")).toBe(false);
    });

    it("returns false for unknown MIME types (safe-default: treat as text)", () => {
        expect(isBinaryContentType("application/x-unknown-format")).toBe(false);
        expect(isBinaryContentType("application/vnd.custom-vendor")).toBe(false);
    });
});
