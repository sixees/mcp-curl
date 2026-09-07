// src/lib/tools/curl-execute.size-and-save.test.ts
// End-to-end guards for the size ceiling and the saved artefact's reported facts.
//
// **At `executeCurlRequest`, not beside the parser or the processor**, because
// what these cases assert is a property of the composition rather than of any
// one link. Each link in isolation does what it was told: the parser returns a
// buffer, the gate measures what it is handed, the saver writes what it is
// given. A unit test beside one of them feeds it the input its author imagined,
// so it cannot see a count taken on one representation and applied to another.
// `LESSONS.md` RC-33.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { readFile, rm } from "fs/promises";
import { CurlExecuteSchema } from "../server/schemas.js";
import { LIMITS } from "../config/index.js";
import {
    METADATA_SEPARATOR as SEP,
    curlOutputFor,
    savedPathFrom as sharedSavedPathFrom,
} from "./curl-output.test-fixture.js";

vi.mock("../types/index.js", async () => {
    const actual = await vi.importActual<typeof import("../types/index.js")>("../types/index.js");
    return { ...actual, generateMetadataSeparator: () => SEP };
});

vi.mock("../security/index.js", async () => {
    const actual = await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        validateUrlAndResolveDns: vi.fn().mockResolvedValue({
            // A literal, not a shared constant: this factory is hoisted above
            // every import, so an imported binding is not initialised yet.
            // See `curl-output.test-fixture.ts`.
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
// `vi.mocked`, not `as Mock`. The bare `Mock` type erases the signature, so
// `mockResolvedValue` accepts `any` and every hand-built fixture in this file is
// unchecked against `CommandResult` — a new required field on it would arrive as
// `undefined` in each of them with the suite green. `vi.mocked` preserves the
// signature, so each site is checked at the point it is written.
const mockedExecuteCommand = vi.mocked(executionModule.executeCommand);

/** Parse through the real schema so tests exercise the true input shape. */
const params = (p: Record<string, unknown>) => CurlExecuteSchema.parse(p);

// **No `output_dir`.** `validateOutputDir` refuses a system directory and the OS
// temp root is one, so a test supplying its own scratch dir exercises the
// refusal path rather than the save path. Letting the server use
// `getOrCreateTempDir()` is also the arrangement production takes.
const written: string[] = [];

beforeEach(() => vi.clearAllMocks());

afterAll(async () => {
    // Only the files these cases created, named individually — never a
    // recursive remove of the server's temp dir, which is shared and not ours.
    await Promise.all(written.map((f) => rm(f, { force: true })));
});

/** Local wrapper: shared finder plus this suite's cleanup registration. */
function savedPathFrom(text: string): string {
    const path = sharedSavedPathFrom(text);
    written.push(path);
    return path;
}

describe("curl_execute size ceiling — both representations are checked", () => {
    it("refuses a body over the cap in wire octets, quoting the wire count", async () => {
        // **This case reaches `processResponse`'s wire arm only because
        // `executeCommand` is stubbed.** In production
        // `command-executor.ts::accountFor` aborts the child before an over-cap
        // chunk is retained, so no real request gets here — the arm is
        // defence-in-depth for a direct internal caller, and this asserts its
        // behaviour rather than an end-to-end guarantee. `ARCHITECTURE.md`
        // invariant 14 names the layer that actually refuses.
        const body = Buffer.alloc(LIMITS.MAX_RESPONSE_SIZE + 1, 0x61);
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "text/plain" })
        );

        const text = (
            await executeCurlRequest(params({ url: "https://example.test/huge" }))
        ).content[0].text;

        expect(text).toContain("exceeds maximum allowed");
        expect(text).toContain(`${body.length} bytes`);
        // **The teeth, and the first version of this case had none.** A decode
        // only ever inflates, so the decoded-length gate strictly subsumes the
        // wire-length one and removing the wire check failed nothing. What the
        // wire check uniquely provides is a TRUE message: this body is ASCII,
        // so it is perfectly valid UTF-8 and merely too big, and the decoded
        // arm's wording would tell the caller otherwise.
        expect(text).not.toContain("not valid UTF-8");
        expect(text).not.toContain("on the wire");
    });

    it("refuses a body under the wire cap whose DECODE exceeds it", async () => {
        // The ceiling has to hold on the decode, because that is what every
        // stage below the gate allocates and the inflation multiplier belongs to
        // the origin. `ARCHITECTURE.md` invariant 14 carries the measurement.
        const cap = LIMITS.MAX_RESPONSE_SIZE;
        const body = Buffer.alloc(cap - 64, 0xe9);
        // Fixture guard: the premise is that the wire fits and the decode does
        // not. If these ever coincide the case below proves nothing, silently.
        expect(body.length).toBeLessThanOrEqual(cap);
        expect(Buffer.byteLength(body.toString("utf8"), "utf8")).toBeGreaterThan(cap);

        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "application/json" })
        );

        const text = (
            await executeCurlRequest(params({ url: "https://example.test/blob" }))
        ).content[0].text;

        expect(text).toContain("exceeds maximum allowed");
        // Both numbers, and the reason. A caller told only the inflated count
        // cannot tell an oversized response from an undecodable one.
        expect(text).toContain(`${body.length} bytes on the wire`);
        expect(text).toContain("not valid UTF-8");
    });

    it("accepts a body that fits in both representations", async () => {
        // The third value: neither of the two refusals above. Without it, a gate
        // that refused everything would pass both cases.
        const body = Buffer.from('{"ok":true}', "utf8");
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "application/json" })
        );

        const text = (
            await executeCurlRequest(params({ url: "https://example.test/small" }))
        ).content[0].text;

        expect(text).not.toContain("exceeds maximum allowed");
        expect(text).toContain('"ok"');
    });
});

describe("curl_execute saved artefact — defended, and honestly measured", () => {
    it("applies the strip stages to what lands on disk", async () => {
        // **The artefact must be safe on every route the server advertises.**
        // `savedMessage` sends a non-JSON file to the model's own tooling,
        // outside every defence pass, because `jq_query` cannot open one — so
        // there is no defended reader to fall back on and the bytes on disk have
        // to be safe as they are.
        //
        // `text/markdown` because it selects both stage sets: HTML runs the
        // markup strip but not the markdown beacon stages, so a beacon would
        // survive and this case would fail for a reason unrelated to its
        // subject.
        const body = Buffer.from(
            "# ok\n\n<script>alert(1)</script> and ![x](https://evil.test/?d=1)",
            "utf8"
        );
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "text/markdown" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/note",
            save_to_file: true,
        }));

        const onDisk = await readFile(savedPathFrom(result.content[0].text), "utf-8");
        expect(onDisk).not.toContain("<script>");
        expect(onDisk).not.toContain("evil.test");
        // And the fixture really does carry something the stages remove, so the
        // assertions above are about the defence rather than about the input.
        expect(body.toString("utf8")).toContain("<script>");
        expect(body.toString("utf8")).toContain("evil.test");
    });

    it("reports a byte count equal to the file's real size", async () => {
        // `savedMessage` quotes this to the model as the size of a file it is
        // about to read. Measured on the buffer that was written rather than
        // re-measured from the string it came from, so the two cannot drift.
        const body = Buffer.from('{"a":"' + "x".repeat(200) + '"}', "utf8");
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/sized",
            save_to_file: true,
        }));

        const text = result.content[0].text;
        const onDisk = await readFile(savedPathFrom(text));
        expect(text).toContain(`(${onDisk.length} bytes)`);
    });
});

describe("curl_execute saved artefact — 'did a filter run' has one answer", () => {
    it("persists the filter's output and names it as such when a filter ran", async () => {
        const body = Buffer.from('{"keep":"yes","drop":"no"}', "utf8");
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body, contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/pick",
            jq_filter: ".keep",
            save_to_file: true,
        }));

        const text = result.content[0].text;
        expect(text).toContain("Result of jq_filter");
        const onDisk = await readFile(savedPathFrom(text), "utf-8");
        expect(onDisk).toContain("yes");
        expect(onDisk).not.toContain("drop");
    });

    it("treats an empty jq_filter as no filter, and says so", async () => {
        // `filterApplied` is the whole guarantee — the schema accepts `""`
        // rather than narrowing a published input (RC-36), so this is the only
        // layer that answers "did a filter produce this content". The wrong
        // outcome it excludes is a body returned whole while the response
        // advertises it as filter output.
        mockedExecuteCommand.mockResolvedValue(
            curlOutputFor({ body: '{"keep":"yes","drop":"no"}', contentType: "application/json" })
        );

        const result = await executeCurlRequest(params({
            url: "https://example.test/x",
            jq_filter: "",
            include_metadata: true,
        }));

        const text = result.content[0].text;
        expect(text).not.toContain("Result of jq_filter");
        const body = JSON.parse(text).response;
        expect(body).toContain("keep");
        expect(body).toContain("drop");
    });
});
