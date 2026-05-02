// src/lib/response/strip-blocks.test.ts
import { describe, it, expect } from "vitest";
import {
    stripBlocksFixedPoint,
    stripHtmlComments,
    stripMarkdownBeacons,
} from "./strip-blocks.js";

describe("stripHtmlComments", () => {
    it("strips a single comment", () => {
        expect(stripHtmlComments("a<!-- x -->b")).toBe("ab");
    });

    it("strips multi-line comments", () => {
        expect(stripHtmlComments("a<!--\nignore\n-->b")).toBe("ab");
    });

    it("strips multiple comments", () => {
        expect(stripHtmlComments("<!--a--><!--b-->c")).toBe("c");
    });

    it("preserves content with no comments", () => {
        expect(stripHtmlComments("<p>x</p>")).toBe("<p>x</p>");
    });
});

describe("stripBlocksFixedPoint — balanced + open-to-EOF", () => {
    it("strips a balanced <script> block", () => {
        expect(stripBlocksFixedPoint("a<script>x()</script>b")).toBe("ab");
    });

    it("strips a balanced <style> block", () => {
        expect(stripBlocksFixedPoint("a<style>body{}</style>b")).toBe("ab");
    });

    it("is case-insensitive", () => {
        expect(stripBlocksFixedPoint("a<SCRIPT>x</SCRIPT>b")).toBe("ab");
        expect(stripBlocksFixedPoint("a<scRiPt>x</ScRiPt>b")).toBe("ab");
    });

    it("does not match <scriptlike> (\\b anchor)", () => {
        expect(stripBlocksFixedPoint("<scriptlike>")).toBe("<scriptlike>");
    });

    it("strips a <script> block with attributes", () => {
        expect(stripBlocksFixedPoint('a<script src="x.js" defer>x()</script>b')).toBe("ab");
    });

    it("strips an unclosed <script> to end-of-string", () => {
        expect(stripBlocksFixedPoint("before<script>steal()")).toBe("before");
    });

    it("strips an unclosed <style> to end-of-string", () => {
        expect(stripBlocksFixedPoint("before<style>body{display:none}")).toBe("before");
    });

    it("strips body when closer has whitespace before 'script'", () => {
        expect(stripBlocksFixedPoint("a<script>x()</ script>b")).toBe("ab");
    });

    it("strips body when closer has newline between '/' and 'script'", () => {
        expect(stripBlocksFixedPoint("a<script>x()</\nscript>b")).toBe("ab");
    });

    it("strips body when closer has trailing attribute-like junk", () => {
        expect(stripBlocksFixedPoint("a<script>x()</script foo>b")).toBe("ab");
    });

    it("neutralises a self-healing payload via fixed-point iteration", () => {
        // After iter 1: balanced inner removes, residue is `<script>` with
        // no closer. After iter 2: open-to-EOF pattern strips the residue.
        const out = stripBlocksFixedPoint("<scr<script>ipt>alert(1)</scr</script>ipt>");
        expect(out.toLowerCase()).not.toContain("<script");
        expect(out).not.toContain("alert(1)");
    });

    it("strips entity-encoded <script> via numeric-entity decode", () => {
        const out = stripBlocksFixedPoint("&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;");
        expect(out.toLowerCase()).not.toContain("<script");
        expect(out).not.toContain("alert(1)");
    });

    it("strips decimal-entity-encoded <script>", () => {
        const out = stripBlocksFixedPoint("&#60;script&#62;alert(1)&#60;/script&#62;");
        expect(out.toLowerCase()).not.toContain("<script");
    });

    it("DROPS surrogate-half numeric entities (P1-C)", () => {
        // U+D800-U+DFFF cannot be safely emitted without producing
        // malformed UTF-16. Decoder returns "" for these.
        expect(stripBlocksFixedPoint("a&#xD800;b")).toBe("ab");
        expect(stripBlocksFixedPoint("a&#xDFFF;b")).toBe("ab");
    });

    it("DROPS out-of-range numeric entities (> 0x10FFFF)", () => {
        expect(stripBlocksFixedPoint("a&#x110000;b")).toBe("ab");
    });

    it("preserves &amp;, &lt;, &gt; named entities (only numeric decoded)", () => {
        // Named entities are intentionally left alone — decoding `&lt;`
        // would re-introduce literal `<` into legitimate code samples.
        expect(stripBlocksFixedPoint("&amp;&lt;script&gt;")).toBe("&amp;&lt;script&gt;");
    });

    it("skips strip path on bodies above 256 KB UTF-8", () => {
        // The byte cap means the function returns the input unchanged.
        // Sanitiser is the caller's responsibility above the cap.
        const filler = "x".repeat(260 * 1024);
        const body = `<script>alert(1)</script>${filler}`;
        const out = stripBlocksFixedPoint(body);
        expect(out).toBe(body);
    });

    it("ReDoS regression: pathological 200 KB body completes well under 100 ms", () => {
        // Nested-near-script payload (`<script>` followed by 200 KB of
        // `<` chars with no closer). Lazy + alternation form is linear-
        // time per match. The 256 KB cap is not engaged here.
        const body = "<script>" + "<".repeat(200 * 1024);
        const start = Date.now();
        stripBlocksFixedPoint(body);
        const elapsedMs = Date.now() - start;
        expect(elapsedMs).toBeLessThan(100);
    });
});

describe("stripMarkdownBeacons — image / link / dangerous-scheme", () => {
    it("replaces external image with [image removed]", () => {
        expect(stripMarkdownBeacons("![logo](https://t.example/p.gif)")).toBe(
            "[image removed]"
        );
    });

    it("replaces external link with [link removed]", () => {
        expect(stripMarkdownBeacons("[click](https://t.example/x)")).toBe(
            "[link removed]"
        );
    });

    it("preserves relative-URL image", () => {
        expect(stripMarkdownBeacons("![local](/a/b.png)")).toBe("![local](/a/b.png)");
    });

    it("preserves relative-URL link", () => {
        expect(stripMarkdownBeacons("[Internal](rel/p.md)")).toBe("[Internal](rel/p.md)");
    });

    it("matches title-syntax `(url \"title\")` (P1-E)", () => {
        const out = stripMarkdownBeacons('![logo](https://t.example/p.gif "Logo")');
        expect(out).toContain("[image removed]");
        expect(out).not.toContain("t.example");
    });

    it("matches link with leading whitespace inside parens (P1-E)", () => {
        expect(stripMarkdownBeacons("[c]( https://t.example/x)")).toBe("[link removed]");
    });

    describe("dangerous-scheme blocklist (S5)", () => {
        // URL char class `[^)\n]` stops at the first `)`. For URLs
        // containing internal `)` (like `alert(1)`), this means the
        // markdown link's outer `)` is consumed as a URL terminator and
        // the actual closer leaves a trailing `)` in the output. The
        // security property — dangerous scheme + URL gone — still holds;
        // the trailing `)` is harmless plain text.

        it("strips javascript: link", () => {
            const out = stripMarkdownBeacons("[c](javascript:alert(1))");
            expect(out).toContain("[link removed]");
            expect(out).not.toContain("javascript:");
        });

        it("strips javascript: link with whitespace after colon (P1-F)", () => {
            const out = stripMarkdownBeacons("[c](javascript: alert(1))");
            expect(out).toContain("[link removed]");
            expect(out).not.toContain("javascript:");
        });

        it("strips javascript: link with leading whitespace before scheme (P1-F)", () => {
            const out = stripMarkdownBeacons("[c]( javascript:alert(1))");
            expect(out).toContain("[link removed]");
            expect(out).not.toContain("javascript:");
        });

        it("strips vbscript: link", () => {
            expect(stripMarkdownBeacons("[c](vbscript:msgbox)")).toBe("[link removed]");
        });

        it("strips file: link", () => {
            expect(stripMarkdownBeacons("[c](file:///etc/passwd)")).toBe("[link removed]");
        });

        it("strips data: image", () => {
            expect(stripMarkdownBeacons("![p](data:image/png;base64,xx)")).toBe(
                "[image removed]"
            );
        });

        it("is case-insensitive on scheme name", () => {
            const out = stripMarkdownBeacons("[c](JAVASCRIPT:alert(1))");
            expect(out).toContain("[link removed]");
            expect(out.toLowerCase()).not.toContain("javascript:");
        });
    });

    it("handles image inside link — inner image URL gone", () => {
        const out = stripMarkdownBeacons(
            "[![alt](https://img.example/x.png)](https://link.example/click)"
        );
        // Inner image URL must be absent.
        expect(out).not.toContain("img.example");
        expect(out).toContain("[image removed]");
    });

    it("preserves text with no links/images", () => {
        expect(stripMarkdownBeacons("just a paragraph")).toBe("just a paragraph");
    });
});
