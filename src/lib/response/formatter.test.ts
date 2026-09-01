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

describe("formatResponse — header metadata", () => {
    const HDRS = "HTTP/2 200 \r\nx-request-id: abc\r\n";

    it("emits the out-of-band truncation keys under include_metadata", () => {
        const out = JSON.parse(
            formatResponse("body", "", 0, true, undefined, HDRS, {
                truncated: true,
                bytesReceived: 90_000,
            })
        );
        expect(out.headers_truncated).toBe(true);
        expect(out.header_bytes_received).toBe(90_000);
    });

    it("emits headers_undetermined under include_metadata", () => {
        const out = JSON.parse(
            formatResponse("body", "", 0, true, undefined, undefined, { undetermined: true })
        );
        expect(out.headers_undetermined).toBe(true);
    });

    it("omits the keys entirely when nothing degraded", () => {
        // Absence must mean "nothing happened", so it cannot be emitted always.
        const out = JSON.parse(formatResponse("body", "", 0, true, undefined, HDRS, {}));
        expect(out.headers_truncated).toBeUndefined();
        expect(out.header_bytes_received).toBeUndefined();
        expect(out.headers_undetermined).toBeUndefined();
    });

    it("signals degradation on the plain branch, which carries no JSON fields", () => {
        const out = formatResponse("body", "", 0, false, undefined, HDRS, {
            truncated: true,
            bytesReceived: 90_000,
        });
        expect(out).toContain("[mcp-curl]");
        expect(out).toContain("truncated");
        // Server-authored and placed BEFORE the remote text, so an origin
        // cannot occupy the position and forge it.
        expect(out.indexOf("[mcp-curl]")).toBeLessThan(out.indexOf("HTTP/2 200"));
    });
});
