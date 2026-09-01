// src/lib/response/parser.test.ts
import { describe, it, expect } from "vitest";
import { splitResponseHeaders } from "./parser.js";

describe("splitResponseHeaders", () => {
    it("returns the body unchanged when there is no status line", () => {
        const raw = '{"id":1}';
        expect(splitResponseHeaders(raw)).toEqual({ body: raw });
    });

    it("splits a CRLF header block from a JSON body", () => {
        const raw =
            "HTTP/2 200 \r\n" +
            "content-type: application/json\r\n" +
            "x-records: 8\r\n" +
            "\r\n" +
            '{"id":1}';

        const { headerText, body } = splitResponseHeaders(raw);

        expect(body).toBe('{"id":1}');
        expect(headerText).toBe(
            "HTTP/2 200 \r\ncontent-type: application/json\r\nx-records: 8"
        );
        // The whole point: what remains must be parseable on its own.
        expect(JSON.parse(body)).toEqual({ id: 1 });
    });

    it("splits an LF-only header block", () => {
        const raw = "HTTP/1.1 200 OK\ncontent-type: application/json\n\n[1,2]";

        const { headerText, body } = splitResponseHeaders(raw);

        expect(headerText).toBe("HTTP/1.1 200 OK\ncontent-type: application/json");
        expect(body).toBe("[1,2]");
    });

    it("keeps every header block across a redirect chain", () => {
        const raw =
            "HTTP/2 301 \r\nlocation: https://example.test/final\r\n\r\n" +
            "HTTP/2 200 \r\ncontent-type: application/json\r\n\r\n" +
            '{"ok":true}';

        const { headerText, body } = splitResponseHeaders(raw);

        expect(body).toBe('{"ok":true}');
        expect(headerText).toContain("301");
        expect(headerText).toContain("location: https://example.test/final");
        expect(headerText).toContain("200");
    });

    it("handles a 1xx informational block preceding the final response", () => {
        const raw =
            "HTTP/1.1 100 Continue\r\n\r\n" +
            "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\n\r\n" +
            '{"created":true}';

        const { headerText, body } = splitResponseHeaders(raw);

        expect(headerText).toContain("100 Continue");
        expect(headerText).toContain("201 Created");
        expect(body).toBe('{"created":true}');
    });

    it("treats an unterminated block as headers with an empty body (HEAD)", () => {
        const raw = "HTTP/2 200 \r\ncontent-length: 4096";

        const { headerText, body } = splitResponseHeaders(raw);

        expect(headerText).toBe(raw);
        expect(body).toBe("");
    });

    it("yields an empty body for a HEAD response terminated normally", () => {
        const raw = "HTTP/2 200 \r\ncontent-length: 4096\r\n\r\n";

        expect(splitResponseHeaders(raw)).toEqual({
            headerText: "HTTP/2 200 \r\ncontent-length: 4096",
            body: "",
        });
    });

    it("does not consume a body that merely starts with the text HTTP/", () => {
        // Guards the redirect-chain loop: a body quoting a status line must
        // not be mistaken for another header block and silently eaten.
        const raw =
            "HTTP/2 200 \r\ncontent-type: text/plain\r\n\r\n" +
            "HTTP/1.1 is the protocol version in use.";

        const { headerText, body } = splitResponseHeaders(raw);

        expect(headerText).toBe("HTTP/2 200 \r\ncontent-type: text/plain");
        expect(body).toBe("HTTP/1.1 is the protocol version in use.");
    });

    it("keeps a blank line inside the body intact", () => {
        // Only the FIRST terminator ends the header block; later blank lines
        // belong to the body.
        const raw = "HTTP/2 200 \r\ncontent-type: text/plain\r\n\r\nfirst\r\n\r\nsecond";

        const { body } = splitResponseHeaders(raw);

        expect(body).toBe("first\r\n\r\nsecond");
    });

    it("does not split when the status line is not at the start", () => {
        const raw = 'leading junk\r\nHTTP/2 200 \r\n\r\n{"id":1}';
        expect(splitResponseHeaders(raw)).toEqual({ body: raw });
    });
});
