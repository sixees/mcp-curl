// src/lib/response/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatResponse } from "./formatter.js";

const HEADERS = "HTTP/2 200 \r\ncontent-type: application/json\r\nx-records: 8";

describe("formatResponse — response headers", () => {
    it("omits the headers section entirely when none are supplied", () => {
        expect(formatResponse('{"id":1}', "", 0, false)).toBe('{"id":1}');
    });

    it("prefixes the body with headers, preserving the previous layout", () => {
        const out = formatResponse('{"id":1}', "", 0, false, undefined, HEADERS);
        expect(out).toBe(`${HEADERS}\n\n{"id":1}`);
    });

    it("reports headers alongside the save message when the body went to a file", () => {
        // Previously headers were written INTO the file, leaving it unparseable
        // and the caller with no headers at all — the message replaced the body.
        const out = formatResponse("", "", 0, false, {
            savedToFile: true,
            filepath: "/tmp/x.txt",
            message: "Response (11524 bytes) saved to: /tmp/x.txt",
        }, HEADERS);

        expect(out).toContain("x-records: 8");
        expect(out).toContain("saved to: /tmp/x.txt");
    });

    it("still returns the bare message when saved without headers", () => {
        const out = formatResponse("", "", 0, false, {
            savedToFile: true,
            filepath: "/tmp/x.txt",
            message: "saved to: /tmp/x.txt",
        });
        expect(out).toBe("saved to: /tmp/x.txt");
    });

    it("exposes headers as a discrete field under include_metadata", () => {
        const parsed = JSON.parse(
            formatResponse('{"id":1}', "", 0, true, undefined, HEADERS)
        );
        expect(parsed.headers).toBe(HEADERS);
        // The body stays a clean, separately parseable document.
        expect(JSON.parse(parsed.response)).toEqual({ id: 1 });
    });

    it("exposes headers under include_metadata when saved to a file", () => {
        const parsed = JSON.parse(
            formatResponse("", "", 0, true, {
                savedToFile: true,
                filepath: "/tmp/x.txt",
                message: "saved",
            }, HEADERS)
        );
        expect(parsed.headers).toBe(HEADERS);
        expect(parsed.filepath).toBe("/tmp/x.txt");
    });

    it("has no headers key when include_metadata is used without headers", () => {
        const parsed = JSON.parse(formatResponse('{"id":1}', "", 0, true));
        expect(parsed).not.toHaveProperty("headers");
    });
});
