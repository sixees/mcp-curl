// src/lib/tools/curl-execute.body-octets.test.ts
// End-to-end guards for octet fidelity on the body path.
//
// **These belong at `executeCurlRequest`, not beside the parser or the
// processor**, and the reason is the defect they guard. Every individual link
// was defensible: the parser was told to return a string and did, the file
// saver was told to write a string and did, the size gate was told to measure a
// string and did. The corruption existed only in the COMPOSITION — a lossy
// decode at the front, and three consumers downstream treating its output as
// the origin's bytes. A test beside any one of them feeds it the input its
// author imagined and passes either way. `LESSONS.md` RC-33.

import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from "vitest";
import { readFile, rm } from "fs/promises";
import { CurlExecuteSchema } from "../server/schemas.js";
import { defendText } from "../response/index.js";
import { LIMITS } from "../config/index.js";
import { METADATA_SEPARATOR as SEP, curlOutputFor } from "./curl-output.test-fixture.js";

vi.mock("../types/index.js", async () => {
    const actual = await vi.importActual<typeof import("../types/index.js")>("../types/index.js");
    return { ...actual, generateMetadataSeparator: () => SEP };
});

vi.mock("../security/index.js", async () => {
    const actual = await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        validateUrlAndResolveDns: vi.fn().mockResolvedValue({
            hostname: "example.test",
            resolvedIp: "93.184.216.34",
            port: 443,
        }),
        checkRateLimits: vi.fn(),
    };
});

vi.mock("../execution/index.js", async () => {
    const actual = await vi.importActual<typeof import("../execution/index.js")>("../execution/index.js");
    return { ...actual, executeCommand: vi.fn() };
});

const executionModule = await import("../execution/index.js");
const { executeCurlRequest } = await import("./curl-execute.js");
const mockedExecuteCommand = executionModule.executeCommand as Mock;

/** Parse through the real schema so tests exercise the true input shape. */
const params = (p: Record<string, unknown>) => CurlExecuteSchema.parse(p);

/**
 * A body that is legal JSON and NOT valid UTF-8: `{"name":"Jos\xe9"}`.
 *
 * ISO-8859-1 `é` is the single octet `0xE9`, which is an invalid UTF-8 start
 * byte. `Buffer.from(str, "utf8")` cannot produce this sequence, so the fixture
 * has to be built byte-wise — that is precisely why the parameter type had to
 * become a Buffer rather than the test being written differently.
 */
const LATIN1_JSON = Buffer.concat([
    Buffer.from('{"name":"Jos', "utf8"),
    Buffer.from([0xe9]),
    Buffer.from('"}', "utf8"),
]);

/** What a UTF-8 decode does to it — three bytes where the origin sent one. */
const LATIN1_JSON_LOSSY = Buffer.from(LATIN1_JSON.toString("utf8"), "utf8");

// **No `output_dir`, deliberately.** The validator refuses a system directory,
// and the OS temp root is one — so a test that supplied its own scratch dir was
// testing the refusal path, not the save path. Letting the server use
// `getOrCreateTempDir()` is also the arrangement production actually takes.
const written: string[] = [];

beforeEach(() => {
    vi.clearAllMocks();
});

afterAll(async () => {
    // Only the files these cases created, named individually. Never a recursive
    // remove of the server's temp dir — it is not ours and it is shared.
    await Promise.all(written.map((f) => rm(f, { force: true })));
});

/**
 * Pull the saved path out of the tool result's server-authored message, and
 * register it for cleanup.
 *
 * Throwing with the message text rather than returning undefined is the point:
 * when the save path is not taken, the reason is in that text, and a test that
 * swallowed it reported a byte-comparison failure against an empty file.
 */
function savedPathFrom(text: string): string {
    const match = /saved to: (\S+?)(?:\s|$)/.exec(text);
    if (!match) throw new Error(`no saved path in result text: ${text.slice(0, 400)}`);
    const path = match[1]!.replace(/[.,]$/, "");
    written.push(path);
    return path;
}

describe("curl_execute body octets — the saved artefact is the origin's bytes", () => {
    it("writes a non-UTF-8 JSON body byte-for-byte, separator present", async () => {
        // The metadata separator IS in this stdout, which is the composition the
        // acceptance criterion names: the parser must slice the body off the
        // suffix and hand the OCTETS of that slice downstream, not a decode of
        // them. Assert byte equality against the wire body, and assert
        // explicitly that the lossy form is NOT what landed — a test that only
        // checked "the file exists" passed throughout the defect's life.
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: LATIN1_JSON, contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/user",
            save_to_file: true,
        }));

        const onDisk = await readFile(savedPathFrom(result.content[0].text));
        expect(onDisk.equals(LATIN1_JSON)).toBe(true);
        expect(onDisk.equals(LATIN1_JSON_LOSSY)).toBe(false);
        // Guard the fixture itself: if these two ever coincide the test above
        // proves nothing, and it would coincide silently.
        expect(LATIN1_JSON.equals(LATIN1_JSON_LOSSY)).toBe(false);
    });

    it("writes a non-UTF-8 body byte-for-byte when no metadata block arrives", async () => {
        // The separator-absent arm is a separate `return` in the parser and had
        // its own `raw.toString("utf8")`. Fixing one arm and not the other is
        // the two-sided-claim shape (`.claude/rules/01-known-shapes.md` K-11),
        // so both arms get a case.
        mockedExecuteCommand.mockResolvedValue({
            stdoutBytes: LATIN1_JSON,
            headerBytes: undefined,
            headerBytesReceived: undefined,
            stderr: "",
            exitCode: 0,
        });

        const result = await executeCurlRequest(params({
            url: "https://example.test/user",
            save_to_file: true,
        }));

        const onDisk = await readFile(savedPathFrom(result.content[0].text));
        expect(onDisk.equals(LATIN1_JSON)).toBe(true);
    });

    it("preserves bytes the strip stages would have rewritten", async () => {
        // Second, independent half of the same guarantee: byte fidelity has to
        // hold for a body the defence WOULD have touched, not only for one it
        // would have passed through.
        //
        // **`text/markdown`, not `application/json`, and that is what gives
        // this case teeth.** Written against a JSON content type it passed
        // whichever representation was persisted, because `excludeJsonDocuments`
        // exempts a JSON document from the markup and markdown stages — so the
        // defended text and the origin bytes were byte-identical and the
        // assertion could not tell them apart. Caught by a teeth probe, not by
        // review (`.claude/rules/01-known-shapes.md` K-1).
        //
        // Markdown rather than `text/html` because the two select different
        // stage sets: HTML runs the markup strip but NOT the markdown beacon
        // stages, so `![x](…)` survived a defence pass and the second assertion
        // below failed for a reason that had nothing to do with persistence.
        // Markdown runs both, which is what makes this fixture's defended form
        // differ from its origin bytes on every axis the case names.
        const withMarkup = Buffer.from(
            '# ok\n\n<script>alert(1)</script> and ![x](https://evil.test/?d=1)',
            "utf8"
        );
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: withMarkup, contentType: "text/markdown" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/note",
            save_to_file: true,
        }));

        const onDisk = await readFile(savedPathFrom(result.content[0].text));
        expect(onDisk.equals(withMarkup)).toBe(true);
        expect(onDisk.toString("utf8")).toContain("<script>alert(1)</script>");
        expect(onDisk.toString("utf8")).toContain("evil.test");
        // The defence genuinely rewrites this input, so the case above is a
        // comparison between two different things rather than a tautology.
        const defended = defendText(withMarkup.toString("utf8"), {
            contentType: "text/markdown",
            contentTypeUndetermined: false,
            hostname: "example.test",
        });
        expect(defended).not.toContain("<script>");
        expect(defended).not.toContain("evil.test");
    });

    it("persists the FILTER's output, not the origin bytes, when jq_filter ran", async () => {
        // The other side of the boundary. With a filter the artefact is this
        // server's own `JSON.stringify` output and there are no origin octets to
        // preserve — so "always write responseBytes" would be wrong, and this is
        // the case that fails if the arm is collapsed.
        const body = Buffer.from('{"keep":"yes","drop":"no"}', "utf8");
        mockedExecuteCommand.mockResolvedValue(curlOutputFor({ body: body, contentType: "application/json" }));

        const result = await executeCurlRequest(params({
            url: "https://example.test/pick",
            jq_filter: ".keep",
            save_to_file: true,
        }));

        const onDisk = await readFile(savedPathFrom(result.content[0].text), "utf-8");
        expect(onDisk).toContain("yes");
        expect(onDisk).not.toContain("drop");
    });
});

describe("curl_execute body octets — the reported size is the size on disk", () => {
    it("reports the wire byte count, not the inflated decode", async () => {
        // `savedMessage` quotes this number to the model as the size of a file
        // it is about to read. Measured on the decoded string it was wrong by
        // two bytes per invalid octet here, and by the strip stages' delta on
        // any body carrying markup.
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: LATIN1_JSON, contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/user",
            save_to_file: true,
        }));

        const text = result.content[0].text;
        const onDisk = await readFile(savedPathFrom(text));
        expect(text).toContain(`(${onDisk.length} bytes)`);
        expect(text).not.toContain(`(${LATIN1_JSON_LOSSY.length} bytes)`);
    });
});

describe("curl_execute body octets — the size cap weighs wire octets", () => {
    it("accepts a body whose wire length fits but whose decode would not", async () => {
        // U+FFFD is three bytes where an invalid octet was one, so gating the
        // decode refused bodies for a size the origin never sent. Build a body
        // just under the cap in wire octets whose decode is comfortably over it,
        // and assert it is NOT refused.
        const cap = LIMITS.MAX_RESPONSE_SIZE;
        const invalidRun = Buffer.alloc(cap - 64, 0xe9);
        const body = Buffer.concat([
            Buffer.from('{"blob":"', "utf8"),
            invalidRun,
            Buffer.from('"}', "utf8"),
        ]);
        // Fixture guard: the premise is that wire fits and decode does not.
        expect(body.length).toBeLessThanOrEqual(cap);
        expect(Buffer.byteLength(body.toString("utf8"), "utf8")).toBeGreaterThan(cap);

        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: body, contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/blob",
            save_to_file: true,
        }));

        const text = result.content[0].text;
        expect(text).not.toContain("exceeds maximum allowed");
        const onDisk = await readFile(savedPathFrom(text));
        expect(onDisk.equals(body)).toBe(true);
    });

    it("still refuses a body genuinely over the cap in wire octets", async () => {
        // The mirror side. Moving the gate onto the octets must not move it off
        // altogether — measured in the direction that matters for a limit.
        const body = Buffer.alloc(LIMITS.MAX_RESPONSE_SIZE + 1, 0x61);
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: body, contentType: "text/plain" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/huge",
        }));

        expect(result.content[0].text).toContain("exceeds maximum allowed");
    });
});
