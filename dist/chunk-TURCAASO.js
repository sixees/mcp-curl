import {
  applyDefaultHeaders,
  executeCurlRequest,
  resolveBaseUrl
} from "./chunk-FBAV2EBE.js";

// src/lib/schema/validator.ts
import { z } from "zod";
var ENDPOINT_ID_REGEX = /^[a-z][a-z0-9_]*$/;
var ApiKeyAuthSchema = z.object({
  type: z.enum(["query", "header"]),
  name: z.string().min(1),
  envVar: z.string().min(1),
  required: z.boolean().default(true)
});
var BearerAuthSchema = z.object({
  envVar: z.string().min(1),
  required: z.boolean().default(true)
});
var AuthConfigSchema = z.object({
  apiKey: ApiKeyAuthSchema.optional(),
  bearer: BearerAuthSchema.optional()
}).optional();
var ParameterSchema = z.object({
  name: z.string().min(1),
  in: z.enum(["path", "query", "header", "body"]),
  type: z.enum(["string", "number", "boolean", "integer"]),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional()
});
var ResponseConfigSchema = z.object({
  jqFilter: z.string().optional(),
  filterPresets: z.array(z.object({
    name: z.string().min(1),
    jqFilter: z.string().min(1),
    description: z.string().trim().min(1).max(500).optional()
  })).optional()
}).optional();
var EndpointSchema = z.object({
  id: z.string().regex(ENDPOINT_ID_REGEX, {
    message: "Endpoint ID must be lowercase, start with a letter, and contain only letters, numbers, and underscores"
  }),
  path: z.string().startsWith("/", {
    message: "Endpoint path must start with /"
  }),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  title: z.string().min(1),
  description: z.string().min(1),
  parameters: z.array(ParameterSchema).optional(),
  response: ResponseConfigSchema
});
var ApiInfoSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  baseUrl: z.url("Base URL must be a valid URL").refine(
    (url) => ["http", "https"].includes(url.split(":")[0].toLowerCase()),
    { message: "Base URL must use http or https scheme" }
  )
});
var ApiDefaultsSchema = z.object({
  timeout: z.number().int().min(1).max(300).optional(),
  headers: z.record(z.string(), z.string()).optional()
}).optional();
var ApiSchemaValidator = z.object({
  apiVersion: z.literal("1.0"),
  api: ApiInfoSchema,
  auth: AuthConfigSchema,
  defaults: ApiDefaultsSchema,
  endpoints: z.array(EndpointSchema).min(1, {
    message: "At least one endpoint must be defined"
  })
});
var ApiSchemaValidationError = class extends Error {
  constructor(message, issues) {
    super(message);
    this.issues = issues;
    this.name = "ApiSchemaValidationError";
  }
};
function validateApiSchema(data) {
  const result = ApiSchemaValidator.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    throw new ApiSchemaValidationError(
      `API schema validation failed:
${messages.join("\n")}`,
      result.error.issues
    );
  }
  const endpointIds = /* @__PURE__ */ new Set();
  for (const endpoint of result.data.endpoints) {
    if (endpointIds.has(endpoint.id)) {
      throw new ApiSchemaValidationError(
        `Duplicate endpoint ID: ${endpoint.id}`,
        []
      );
    }
    endpointIds.add(endpoint.id);
  }
  for (const endpoint of result.data.endpoints) {
    const pathParams = endpoint.path.match(/\{([^}]+)\}/g) || [];
    const definedPathParams = new Set(
      (endpoint.parameters || []).filter((p) => p.in === "path").map((p) => p.name)
    );
    for (const pathParam of pathParams) {
      const paramName = pathParam.slice(1, -1);
      if (!definedPathParams.has(paramName)) {
        throw new ApiSchemaValidationError(
          `Path parameter {${paramName}} in endpoint "${endpoint.id}" is not defined in parameters`,
          []
        );
      }
    }
  }
  return result.data;
}

// src/lib/schema/loader.ts
import { readFile } from "fs/promises";
import yaml from "js-yaml";
var ApiSchemaLoadError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "ApiSchemaLoadError";
  }
};
function parseYaml(content) {
  try {
    return yaml.load(content, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      const lineInfo = error.mark ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}` : "";
      throw new ApiSchemaLoadError(
        `Failed to parse YAML${lineInfo}: ${error.message}`,
        error
      );
    }
    throw new ApiSchemaLoadError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
async function loadApiSchema(definitionPath) {
  let content;
  try {
    content = await readFile(definitionPath, "utf-8");
  } catch (error) {
    throw new ApiSchemaLoadError(
      `Failed to read API schema file: ${definitionPath}`,
      error instanceof Error ? error : void 0
    );
  }
  const parsed = parseYaml(content);
  if (parsed === null || parsed === void 0) {
    throw new ApiSchemaLoadError(
      `API schema file is empty: ${definitionPath}`
    );
  }
  return validateApiSchema(parsed);
}
function loadApiSchemaFromString(yamlContent) {
  const parsed = parseYaml(yamlContent);
  if (parsed === null || parsed === void 0) {
    throw new ApiSchemaLoadError("API schema content is empty");
  }
  return validateApiSchema(parsed);
}

// src/lib/schema/generator.ts
import { z as z2 } from "zod";
var AuthenticationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthenticationError";
  }
};
function generateInputSchema(endpoint) {
  const shape = {};
  for (const param of endpoint.parameters ?? []) {
    let schema = createParamSchema(param);
    if (param.description) {
      schema = schema.describe(param.description);
    }
    if (!param.required) {
      schema = schema.optional();
    }
    shape[param.name] = schema;
  }
  if (endpoint.response?.filterPresets?.length) {
    const presetNames = endpoint.response.filterPresets.map((p) => p.name);
    if (presetNames.length === 1) {
      shape.filter_preset = z2.literal(presetNames[0]).optional().describe("Apply a predefined response filter");
    } else {
      shape.filter_preset = z2.enum(presetNames).optional().describe("Apply a predefined response filter");
    }
  }
  return z2.object(shape);
}
function createParamSchema(param) {
  if (param.enum && param.enum.length > 0) {
    const firstValue = param.enum[0];
    if (typeof firstValue === "string") {
      if (param.enum.length === 1) {
        return z2.literal(firstValue);
      }
      return z2.enum(param.enum);
    } else {
      if (param.enum.length === 1) {
        return z2.literal(firstValue);
      }
      return z2.union(
        param.enum.map((v) => z2.literal(v))
      );
    }
  }
  switch (param.type) {
    case "number":
      return z2.number();
    case "integer":
      return z2.number().int();
    case "boolean":
      return z2.boolean();
    case "string":
    default:
      return z2.string();
  }
}
function buildUrl(baseUrl, path, pathParams, queryParams) {
  let resolvedPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    resolvedPath = resolvedPath.replace(
      `{${key}}`,
      encodeURIComponent(String(value))
    );
  }
  const url = resolveBaseUrl(baseUrl, resolvedPath);
  const queryEntries = Object.entries(queryParams);
  if (queryEntries.length === 0) {
    return url;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of queryEntries) {
    searchParams.append(key, value);
  }
  return `${url}?${searchParams.toString()}`;
}
function getAuthConfig(auth, override) {
  const headers = {};
  const queryParams = {};
  if (!auth) {
    return { headers, queryParams };
  }
  if (auth.apiKey) {
    const value = override?.[auth.apiKey.envVar] ?? process.env[auth.apiKey.envVar];
    const isRequired = auth.apiKey.required !== false;
    if (!value && isRequired) {
      throw new AuthenticationError(
        `Missing required environment variable: ${auth.apiKey.envVar}`
      );
    }
    if (value) {
      if (auth.apiKey.type === "header") {
        headers[auth.apiKey.name] = value;
      } else {
        queryParams[auth.apiKey.name] = value;
      }
    }
  }
  if (auth.bearer) {
    const value = override?.[auth.bearer.envVar] ?? process.env[auth.bearer.envVar];
    const isRequired = auth.bearer.required !== false;
    if (!value && isRequired) {
      throw new AuthenticationError(
        `Missing required environment variable: ${auth.bearer.envVar}`
      );
    }
    if (value) {
      headers["Authorization"] = `Bearer ${value}`;
    }
  }
  return { headers, queryParams };
}
function separateParams(endpoint, params) {
  const pathParams = {};
  const queryParams = {};
  const headerParams = {};
  const bodyParams = {};
  for (const paramDef of endpoint.parameters ?? []) {
    let value = params[paramDef.name];
    if (value === void 0 && paramDef.default !== void 0) {
      value = paramDef.default;
    }
    if (value === void 0) {
      continue;
    }
    switch (paramDef.in) {
      case "path":
        pathParams[paramDef.name] = value;
        break;
      case "query":
        queryParams[paramDef.name] = String(value);
        break;
      case "header":
        headerParams[paramDef.name] = String(value);
        break;
      case "body":
        bodyParams[paramDef.name] = value;
        break;
    }
  }
  let bodyData;
  const bodyKeys = Object.keys(bodyParams);
  if (bodyKeys.length === 1) {
    const value = bodyParams[bodyKeys[0]];
    bodyData = typeof value === "string" ? value : JSON.stringify(value);
  } else if (bodyKeys.length > 1) {
    bodyData = JSON.stringify(bodyParams);
  }
  return { pathParams, queryParams, headerParams, bodyData };
}
function resolveJqFilter(endpoint, params) {
  const presetName = params.filter_preset;
  if (presetName && endpoint.response?.filterPresets) {
    const preset = endpoint.response.filterPresets.find((p) => p.name === presetName);
    if (preset) {
      return preset.jqFilter;
    }
    const available = endpoint.response.filterPresets.map((p) => p.name).join(", ");
    throw new Error(
      `Unknown filter preset "${presetName}". Available presets: ${available}`
    );
  }
  return endpoint.response?.jqFilter;
}
function createToolHandler(schema, endpoint, config) {
  return async (params, extra) => {
    try {
      const { pathParams, queryParams, headerParams, bodyData } = separateParams(
        endpoint,
        params
      );
      const auth = getAuthConfig(schema.auth, config?.authOverride);
      const url = buildUrl(
        config?.baseUrl ?? schema.api.baseUrl,
        endpoint.path,
        pathParams,
        { ...queryParams, ...auth.queryParams }
      );
      const mergedHeaders = {
        ...config?.defaultHeaders,
        ...schema.defaults?.headers,
        ...auth.headers,
        ...headerParams
      };
      const defaults = applyDefaultHeaders(mergedHeaders, void 0, config);
      const headers = defaults.headers;
      if (defaults.userAgent !== void 0) headers["User-Agent"] = defaults.userAgent;
      const jqFilter = resolveJqFilter(endpoint, params);
      const timeout = config?.timeout ?? schema.defaults?.timeout;
      const execExtra = {
        ...extra,
        allowLocalhost: config?.allowLocalhost ?? extra?.allowLocalhost
      };
      return await executeCurlRequest(
        {
          url,
          method: endpoint.method,
          headers: Object.keys(headers).length > 0 ? headers : void 0,
          data: bodyData,
          timeout,
          jq_filter: jqFilter,
          // Required fields with standard defaults
          follow_redirects: true,
          insecure: false,
          verbose: false,
          include_headers: false,
          compressed: true,
          include_metadata: false
        },
        execExtra
      );
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return {
          content: [
            {
              type: "text",
              text: `Authentication error: ${error.message}`
            }
          ],
          isError: true
        };
      }
      if (error instanceof Error && error.message.startsWith("Unknown filter preset")) {
        return {
          content: [
            {
              type: "text",
              text: error.message
            }
          ],
          isError: true
        };
      }
      throw error;
    }
  };
}
function getMethodAnnotations(method) {
  return {
    readOnlyHint: method === "GET" || method === "HEAD" || method === "OPTIONS",
    destructiveHint: method === "DELETE",
    idempotentHint: method === "GET" || method === "PUT" || method === "HEAD" || method === "OPTIONS",
    openWorldHint: true
  };
}
function buildToolDescription(endpoint) {
  const parts = [endpoint.description];
  const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]+/g;
  if (endpoint.response?.filterPresets?.length) {
    parts.push("");
    parts.push("Available filter presets:");
    for (const preset of endpoint.response.filterPresets) {
      if (preset.description) {
        const desc = preset.description.replace(CONTROL_CHARS, " ");
        parts.push(`  - ${preset.name}: ${desc}`);
      } else {
        const safeFilter = preset.jqFilter.replace(CONTROL_CHARS, " ");
        parts.push(`  - ${preset.name}: applies filter "${safeFilter}"`);
      }
    }
  }
  return parts.join("\n");
}
function registerEndpointTools(server, schema, config) {
  for (const endpoint of schema.endpoints) {
    const inputSchema = generateInputSchema(endpoint);
    const handler = createToolHandler(schema, endpoint, config);
    server.registerTool(
      endpoint.id,
      {
        title: endpoint.title,
        description: buildToolDescription(endpoint),
        inputSchema,
        annotations: getMethodAnnotations(endpoint.method)
      },
      handler
    );
  }
}
function generateToolDefinitions(schema, config) {
  return schema.endpoints.map((endpoint) => ({
    id: endpoint.id,
    title: endpoint.title,
    description: buildToolDescription(endpoint),
    method: endpoint.method,
    inputSchema: generateInputSchema(endpoint),
    handler: createToolHandler(schema, endpoint, config)
  }));
}

export {
  ApiSchemaValidator,
  ApiSchemaValidationError,
  validateApiSchema,
  ApiSchemaLoadError,
  loadApiSchema,
  loadApiSchemaFromString,
  AuthenticationError,
  generateInputSchema,
  buildUrl,
  getAuthConfig,
  getMethodAnnotations,
  registerEndpointTools,
  generateToolDefinitions
};
