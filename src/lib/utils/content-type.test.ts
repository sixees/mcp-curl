import { describe, it, expect } from "vitest";
import {
    isBinaryContentType,
    isMarkdownContentType,
    isPlainTextLikeContentType,
    looksLikeMarkupShape,
    parseMimeType,
    supportsMarkupComments,
} from "./content-type.js";

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

    it("returns true for raster/binary image MIME types", () => {
        expect(isBinaryContentType("image/png")).toBe(true);
        expect(isBinaryContentType("image/jpeg")).toBe(true);
        expect(isBinaryContentType("image/webp")).toBe(true);
        expect(isBinaryContentType("image/gif")).toBe(true);
    });

    it("returns false for image/svg+xml (text XML — must go through sanitization)", () => {
        // SVG is text XML and can carry <script>, comments, and bidi/zero-width
        // injection just like any other text payload. Despite the image/* prefix,
        // it must NOT be treated as binary.
        expect(isBinaryContentType("image/svg+xml")).toBe(false);
        expect(isBinaryContentType("IMAGE/SVG+XML")).toBe(false);
        expect(isBinaryContentType("image/svg+xml; charset=utf-8")).toBe(false);
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

    it("returns true for legacy Microsoft Word MIME type", () => {
        // application/msword has no hyphen separator, so vnd.ms-* startsWith
        // would not match it — equality check must cover it explicitly.
        expect(isBinaryContentType("application/msword")).toBe(true);
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

describe("supportsMarkupComments", () => {
    it("returns false for undefined/empty", () => {
        expect(supportsMarkupComments(undefined)).toBe(false);
        expect(supportsMarkupComments("")).toBe(false);
    });

    it("returns true for text/html", () => {
        expect(supportsMarkupComments("text/html")).toBe(true);
        expect(supportsMarkupComments("text/html; charset=utf-8")).toBe(true);
    });

    it("returns true for XHTML", () => {
        expect(supportsMarkupComments("application/xhtml+xml")).toBe(true);
    });

    it("returns true for generic XML", () => {
        expect(supportsMarkupComments("application/xml")).toBe(true);
        expect(supportsMarkupComments("text/xml")).toBe(true);
    });

    it("returns true for SVG (image/svg+xml)", () => {
        expect(supportsMarkupComments("image/svg+xml")).toBe(true);
    });

    it("returns true for any +xml structured-syntax suffix", () => {
        expect(supportsMarkupComments("application/atom+xml")).toBe(true);
        expect(supportsMarkupComments("application/rss+xml")).toBe(true);
        expect(supportsMarkupComments("application/vnd.custom+xml")).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(supportsMarkupComments("TEXT/HTML")).toBe(true);
        expect(supportsMarkupComments("Application/XHTML+XML")).toBe(true);
    });

    it("returns false for non-markup content types", () => {
        expect(supportsMarkupComments("application/json")).toBe(false);
        expect(supportsMarkupComments("text/plain")).toBe(false);
        expect(supportsMarkupComments("text/css")).toBe(false);
        expect(supportsMarkupComments("application/javascript")).toBe(false);
        expect(supportsMarkupComments("image/png")).toBe(false);
    });
});

describe("isMarkdownContentType (PR-7 / B8)", () => {
    it("returns false for undefined/empty", () => {
        expect(isMarkdownContentType(undefined)).toBe(false);
        expect(isMarkdownContentType("")).toBe(false);
    });

    it("returns true for canonical text/markdown (RFC 7763)", () => {
        expect(isMarkdownContentType("text/markdown")).toBe(true);
        expect(isMarkdownContentType("text/markdown; charset=utf-8")).toBe(true);
    });

    it("returns true for legacy text/x-markdown", () => {
        expect(isMarkdownContentType("text/x-markdown")).toBe(true);
    });

    it("returns true for any +markdown structured-syntax suffix", () => {
        expect(isMarkdownContentType("application/vnd.custom+markdown")).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(isMarkdownContentType("TEXT/MARKDOWN")).toBe(true);
        expect(isMarkdownContentType("Text/X-Markdown")).toBe(true);
    });

    it("strips parameters before classifying", () => {
        expect(isMarkdownContentType("text/markdown; variant=GFM")).toBe(true);
    });

    it("returns false for adjacent text content types", () => {
        expect(isMarkdownContentType("text/html")).toBe(false);
        expect(isMarkdownContentType("text/plain")).toBe(false);
        expect(isMarkdownContentType("application/json")).toBe(false);
        expect(isMarkdownContentType("image/png")).toBe(false);
    });

    it("does not match the bare 'markdown' word inside an unrelated MIME", () => {
        // The structured-syntax suffix MUST be `+markdown`, not the word
        // anywhere in the type — otherwise vendor MIMEs that happen to
        // contain the substring would mis-fire.
        expect(isMarkdownContentType("text/markdownish")).toBe(false);
        expect(isMarkdownContentType("application/markdown-extra")).toBe(false);
    });
});

describe("parseMimeType — non-string runtime guard (round-3 P2-2)", () => {
    it("returns empty string for a number contentType (defends JS-caller path)", () => {
        expect(parseMimeType(42 as unknown as string)).toBe("");
    });

    it("returns empty string for an object contentType", () => {
        expect(parseMimeType({} as unknown as string)).toBe("");
    });

    it("returns empty string for an array contentType", () => {
        expect(parseMimeType([] as unknown as string)).toBe("");
    });

    it("returns empty string for boolean contentType", () => {
        expect(parseMimeType(true as unknown as string)).toBe("");
    });
});

describe("isPlainTextLikeContentType (round-3 P1-1 sniffer gate)", () => {
    it("returns true for undefined", () => {
        expect(isPlainTextLikeContentType(undefined)).toBe(true);
    });

    it("returns true for empty string", () => {
        expect(isPlainTextLikeContentType("")).toBe(true);
    });

    it("returns true for text/plain (with or without parameters)", () => {
        expect(isPlainTextLikeContentType("text/plain")).toBe(true);
        expect(isPlainTextLikeContentType("text/plain; charset=utf-8")).toBe(true);
    });

    it("returns false for structured types", () => {
        expect(isPlainTextLikeContentType("application/json")).toBe(false);
        expect(isPlainTextLikeContentType("text/html")).toBe(false);
        expect(isPlainTextLikeContentType("text/markdown")).toBe(false);
        expect(isPlainTextLikeContentType("application/xml")).toBe(false);
        expect(isPlainTextLikeContentType("image/png")).toBe(false);
    });
});

describe("looksLikeMarkupShape (round-3 P1-1 sniffer)", () => {
    it("matches a body starting with <!doctype", () => {
        expect(looksLikeMarkupShape("<!doctype html><html>...</html>")).toBe(true);
    });

    it("matches a body starting with <html", () => {
        expect(looksLikeMarkupShape("<html><body>x</body></html>")).toBe(true);
    });

    it("matches a body starting with <script", () => {
        expect(looksLikeMarkupShape("<script>alert(1)</script>")).toBe(true);
    });

    it("matches a body starting with <svg", () => {
        expect(looksLikeMarkupShape("<svg><circle/></svg>")).toBe(true);
    });

    it("matches a body starting with <iframe", () => {
        expect(looksLikeMarkupShape("<iframe src=evil>")).toBe(true);
    });

    it("matches a body starting with <?xml", () => {
        expect(looksLikeMarkupShape('<?xml version="1.0"?><root/>')).toBe(true);
    });

    it("matches a generic <tagname> opener", () => {
        expect(looksLikeMarkupShape("<p>hello</p>")).toBe(true);
        expect(looksLikeMarkupShape("<x-component>...</x-component>")).toBe(true);
    });

    it("matches when markup appears WITHIN the first 1 KB", () => {
        const padded = "leading text. ".repeat(20) + "<script>alert(1)</script>";
        expect(looksLikeMarkupShape(padded)).toBe(true);
    });

    it("does NOT match prose mentioning `<`", () => {
        // Plain arithmetic / prose with `<` shouldn't trip the detector.
        expect(looksLikeMarkupShape("the value is < 5")).toBe(false);
        expect(looksLikeMarkupShape("a < b but b > c")).toBe(false);
    });

    it("does NOT match plain JSON", () => {
        expect(looksLikeMarkupShape('{"key": "value"}')).toBe(false);
    });

    it("does NOT match markup buried beyond the first 1 KB (bounded scan)", () => {
        // Scan is bounded to first 1024 chars to bound cost on adversarial
        // bodies. Markup buried after 1 KB of prose is missed — that's
        // intentional; the sanitiser still runs on the full body.
        const buried = "x".repeat(1100) + "<script>alert(1)</script>";
        expect(looksLikeMarkupShape(buried)).toBe(false);
    });
});
