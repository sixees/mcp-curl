import {
  McpCurlServer
} from "./chunk-T47GQP6N.js";
import {
  generateToolDefinitions,
  getMethodAnnotations,
  loadApiSchema,
  loadApiSchemaFromString,
  validateApiSchema
} from "./chunk-U3EDJZ2W.js";

// src/lib/api-server.ts
function configureServerFromSchema(server, schema, options) {
  const schemaConfig = {
    baseUrl: schema.api.baseUrl
  };
  if (schema.defaults?.headers) {
    schemaConfig.defaultHeaders = schema.defaults.headers;
  }
  if (schema.defaults?.timeout) {
    schemaConfig.defaultTimeout = schema.defaults.timeout;
  }
  server.configure({
    ...schemaConfig,
    ...options.config
  });
  if (options.disableCurlExecute) {
    server.disableCurlExecute();
  }
  if (options.disableJqQuery) {
    server.disableJqQuery();
  }
  const mergedConfig = { ...schemaConfig, ...options.config };
  const generatorConfig = {
    defaultHeaders: schema.defaults?.headers,
    timeout: schema.defaults?.timeout,
    baseUrl: mergedConfig.baseUrl,
    allowLocalhost: mergedConfig.allowLocalhost,
    defaultUserAgent: mergedConfig.defaultUserAgent,
    defaultReferer: mergedConfig.defaultReferer,
    ...options.generatorConfig,
    // PR-6b: server-level enableSpotlighting is authoritative across all
    // tool paths and must NOT be overridable via options.generatorConfig.
    // Set after the spread so the asymmetry it closes (built-in tools
    // spotlight; YAML tools opt out via generatorConfig) cannot reappear.
    enableSpotlighting: mergedConfig.enableSpotlighting
  };
  const toolDefs = generateToolDefinitions(schema, generatorConfig);
  for (const toolDef of toolDefs) {
    server.registerCustomTool(
      toolDef.id,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        annotations: getMethodAnnotations(toolDef.method)
      },
      toolDef.handler
    );
  }
}
async function createApiServer(options) {
  let schema;
  if (options.schema) {
    schema = validateApiSchema(options.schema);
  } else if (options.definitionPath) {
    schema = await loadApiSchema(options.definitionPath);
  } else if (options.definitionContent) {
    schema = loadApiSchemaFromString(options.definitionContent);
  } else {
    throw new Error(
      "Must provide one of: definitionPath, definitionContent, or schema"
    );
  }
  const server = new McpCurlServer();
  configureServerFromSchema(server, schema, options);
  return server;
}
function createApiServerSync(schema, options = {}) {
  const validated = validateApiSchema(schema);
  const server = new McpCurlServer();
  configureServerFromSchema(server, validated, options);
  return server;
}

export {
  createApiServer,
  createApiServerSync
};
