// src/lib/tools/curl-execute.host-policy.test.ts
// The host list refuses before DNS, on every path a request can take into executeCurlRequest

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CurlExecuteSchema } from "../server/schemas.js";
import { McpCurlServer } from "../extensible/mcp-curl-server.js";
import { stubServerFactory, type CapturedTool } from "../extensible/tool-capture.test-fixture.js";
import { createApiServerSync } from "../api-server.js";
import { generateToolDefinitions, loadApiSchemaFromString } from "../schema/index.js";
import { ANY_HOST_POLICY, deriveHostPolicy } from "../config/index.js";

vi.mock("../security/index.js", async () => {
    const actual = await vi.importActual<typeof import("../security/index.js")>("../security/index.js");
    return {
        ...actual,
        // The refusal text is the same whether the host list ran before or after
        // DNS, so the assertions below check this was never reached rather than
        // reading the text.
        validateUrlAndResolveDns: vi.fn().mockRejectedValue(new Error("validator reached")),
        checkRateLimits: vi.fn(),
    };
});

vi.mock("../execution/index.js", async () => {
    const actual = await vi.importActual<typeof import("../execution/index.js")>("../execution/index.js");
    return { ...actual, executeCommand: vi.fn() };
});

const security = await import("../security/index.js");
const execution = await import("../execution/index.js");
const { executeCurlRequest } = await import("./curl-execute.js");

const REFUSAL =
    "Refused locally: no request was sent (LOCAL_HOST_NOT_ALLOWED). The target host is not in this server's allowedHosts list.";
const LOG_LINE = "curl_execute error: [other.test] LocalRefusalError LOCAL_HOST_NOT_ALLOWED";

const textOf = (result: unknown) =>
    (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("\n");

const YAML = `
apiVersion: "1.0"
api:
  name: host-policy-api
  title: Host policy API
  description: An API on a host the list leaves out
  version: "1.0"
  baseUrl: https://other.test/v1
endpoints:
  - id: get_thing
    path: /thing
    method: GET
    title: Get thing
    description: Get the thing
`;

describe("the host list in executeCurlRequest", () => {
    let errorLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.mocked(security.validateUrlAndResolveDns).mockClear();
        vi.mocked(security.checkRateLimits).mockClear();
        vi.mocked(execution.executeCommand).mockClear();
        errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const expectRefusedBeforeDns = (result: unknown) => {
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(textOf(result)).toContain(REFUSAL);
        expect(textOf(result)).not.toContain("Error executing cURL request");
        expect(security.validateUrlAndResolveDns).not.toHaveBeenCalled();
        expect(security.checkRateLimits).not.toHaveBeenCalled();
        expect(execution.executeCommand).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalledWith(LOG_LINE);
        // The log carries the code, never the message.
        expect(errorLog.mock.calls.flat().join("\n")).not.toContain("Refused locally");
    };

    it("refuses a host off the list without resolving it", async () => {
        const policy = deriveHostPolicy({ baseUrl: "https://api.test" });
        const result = await executeCurlRequest(CurlExecuteSchema.parse({ url: "https://other.test/x" }), {
            hostPolicy: policy,
        });
        expect(result.content).toEqual([{ type: "text", text: REFUSAL }]);
        expectRefusedBeforeDns(result);
    });

    it("lets a listed host through to the SSRF gate", async () => {
        const policy = deriveHostPolicy({ baseUrl: "https://api.test" });
        const result = await executeCurlRequest(CurlExecuteSchema.parse({ url: "https://API.test./x" }), {
            hostPolicy: policy,
        });
        expect(security.validateUrlAndResolveDns).toHaveBeenCalledOnce();
        expect(textOf(result)).toContain("Error executing cURL request: validator reached");
    });

    it.each([
        ["no policy (the library default)", undefined],
        ['"any"', ANY_HOST_POLICY],
    ])("lets any host through to the SSRF gate with %s", async (_label, hostPolicy) => {
        await executeCurlRequest(CurlExecuteSchema.parse({ url: "https://other.test/x" }), { hostPolicy });
        expect(security.validateUrlAndResolveDns).toHaveBeenCalledOnce();
    });

    it("refuses every host for an empty list", async () => {
        const result = await executeCurlRequest(CurlExecuteSchema.parse({ url: "https://api.test/x" }), {
            hostPolicy: deriveHostPolicy({ allowedHosts: [] }),
        });
        expect(textOf(result)).toContain("(LOCAL_HOST_NOT_ALLOWED)");
        expect(security.validateUrlAndResolveDns).not.toHaveBeenCalled();
    });

    it("keeps the old prefix and message for an error that is not a local refusal", async () => {
        const result = await executeCurlRequest(CurlExecuteSchema.parse({ url: "https://api.test/x" }), {
            hostPolicy: ANY_HOST_POLICY,
        });
        expect(textOf(result)).toBe("Error executing cURL request: validator reached");
        expect(errorLog).toHaveBeenCalledWith("curl_execute error: [api.test] Error");
    });

    describe("a URL WHATWG and cURL parse to different hosts", () => {
        const policy = deriveHostPolicy({ allowedHosts: ["allowed.test"] });

        it("hands the SSRF gate and cURL the parsed href, not the raw URL", async () => {
            vi.mocked(security.validateUrlAndResolveDns).mockResolvedValueOnce({
                hostname: "allowed.test",
                port: 80,
                resolvedIp: "93.184.216.34",
            });
            vi.mocked(execution.executeCommand).mockRejectedValueOnce(new Error("cURL reached"));
            const raw = "http://allowed.test\\@evil.test/";
            const href = "http://allowed.test/@evil.test/";

            const result = await executeCurlRequest(CurlExecuteSchema.parse({ url: raw }), { hostPolicy: policy });

            expect(textOf(result)).toContain("cURL reached");
            expect(security.validateUrlAndResolveDns).toHaveBeenCalledWith(href, expect.anything());
            const argv = vi.mocked(execution.executeCommand).mock.calls[0][1];
            expect(argv).toContain(href);
            expect(argv).not.toContain(raw);
        });

        it("refuses the reverse order, whose parsed host is off the list", async () => {
            const result = await executeCurlRequest(
                CurlExecuteSchema.parse({ url: "http://other.test\\@allowed.test/" }),
                { hostPolicy: policy }
            );
            expectRefusedBeforeDns(result);
        });
    });

    it("a generated handler with no hostPolicy of its own keeps the caller's", async () => {
        const [tool] = generateToolDefinitions(loadApiSchemaFromString(YAML));
        const result = await tool.handler({}, { hostPolicy: deriveHostPolicy({ allowedHosts: [] }) });
        expect(textOf(result)).toContain("(LOCAL_HOST_NOT_ALLOWED)");
        expect(security.validateUrlAndResolveDns).not.toHaveBeenCalled();
    });

    describe("on every path a request takes", () => {
        let tools: Map<string, CapturedTool>;
        let server: McpCurlServer;

        beforeEach(() => {
            ({ tools } = stubServerFactory());
        });

        afterEach(async () => {
            await server.shutdown();
        });

        it("curl_execute on a baseUrl server", async () => {
            server = new McpCurlServer().configure({ baseUrl: "https://api.test" });
            await server.start("stdio");
            const result = await tools.get("curl_execute")!.handler({ url: "https://other.test/x" }, {});
            expectRefusedBeforeDns(result);
        });

        it("utilities().executeRequest on a baseUrl server", async () => {
            server = new McpCurlServer().configure({ baseUrl: "https://api.test" });
            expectRefusedBeforeDns(await server.utilities().executeRequest({ url: "https://other.test/x" }));
        });

        it("a YAML tool whose baseUrl host the list leaves out", async () => {
            server = createApiServerSync(loadApiSchemaFromString(YAML), {
                config: { allowedHosts: ["api.test"] },
            });
            await server.start("stdio");
            expectRefusedBeforeDns(await tools.get("get_thing")!.handler({}, {}));
        });
    });
});
