// src/lib/response/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseResponseWithMetadata } from "./parser.js";
import { LIMITS } from "../config/limits.js";

/** parseResponseWithMetadata takes exact octets; tests mostly start from strings. */
const buf = (s: string) => Buffer.from(s, "utf8");

describe("parseResponseWithMetadata", () => {
    const SEP = "\n---MCP-CURL-test-separator---\n";

    it("reads the content type from the metadata block", () => {
        const raw = `{"id":1}${SEP}application/json`;
        const parsed = parseResponseWithMetadata(buf(raw), SEP);
        expect(parsed.body).toBe('{"id":1}');
        expect(parsed.contentType).toBe("application/json");
        expect(parsed.metadataFound).toBe(true);
    });

    it("distinguishes an absent metadata block from an empty content type", () => {
        // These must not collapse: "the origin sent no Content-Type" and "we
        // could not find our own metadata" select different defences, and only
        // the second means every curl-authored field is missing.
        const empty = parseResponseWithMetadata(buf(`{"id":1}${SEP}`), SEP);
        expect(empty.metadataFound).toBe(true);
        expect(empty.contentType).toBeUndefined();

        const absent = parseResponseWithMetadata(buf("plain body"), SEP);
        expect(absent.body).toBe("plain body");
        expect(absent.metadataFound).toBe(false);
        expect(absent.contentType).toBeUndefined();
    });

    it("takes a crafted content-type whole rather than parsing fields out of it", () => {
        // The remote controls every byte of this field. It is safe as the
        // block's entire content — nothing follows it to spoof — so digits and
        // spaces inside it are content, never structure.
        const hostile = '12 text/plain; charset="999999 evil"';
        const parsed = parseResponseWithMetadata(buf(`body${SEP}${hostile}`), SEP);
        expect(parsed.contentType).toBe(hostile);
        expect(parsed.body).toBe("body");
    });
});

describe("parseResponseWithMetadata — window sizing", () => {
    const SEP = "\n---MCP-CURL-00000000-0000-4000-8000-000000000000---\n";

    it("still finds the separator behind a long remote-chosen Content-Type", () => {
        // A legal Content-Type this long used to evict the separator from a flat
        // 200-byte window, at which point the block read as absent and the strip
        // stages silently deselected on an ordinary reply.
        const longCt =
            'application/vnd.api+json; charset=utf-8; profile="' + "x".repeat(300) + '"';
        const raw = `{"id":1}${SEP}${longCt}`;

        const parsed = parseResponseWithMetadata(buf(raw), SEP);

        expect(parsed.metadataFound).toBe(true);
        expect(parsed.contentType).toBe(longCt);
        expect(parsed.body).toBe('{"id":1}');
    });

    it("marks metadata as not found once the field allowance is exceeded", () => {
        // The positive case proves the 200-byte regression is gone; this proves
        // where the new boundary actually is, so a future widening or narrowing
        // of MAX_METADATA_TAIL_LENGTH is visible rather than silent.
        const tooLongCt = "text/plain; profile=\"" + "x".repeat(LIMITS.MAX_METADATA_TAIL_LENGTH) + "\"";
        const parsed = parseResponseWithMetadata(buf(`body${SEP}${tooLongCt}`), SEP);

        expect(parsed.metadataFound).toBe(false);
        expect(parsed.contentType).toBeUndefined();
    });

    it("marks metadata as not found rather than guessing", () => {
        const parsed = parseResponseWithMetadata(buf("plain body"), SEP);
        expect(parsed.metadataFound).toBe(false);
        expect(parsed.contentType).toBeUndefined();
    });
});
