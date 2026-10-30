import {
  McpCurlServer
} from "./chunk-CYEBK3WA.js";
import {
  generateToolDefinitions,
  getMethodAnnotations,
  loadApiSchema,
  loadApiSchemaFromString,
  validateApiSchema
} from "./chunk-IGDL3KJD.js";
import {
  deriveHostPolicy
} from "./chunk-JYNFNJA6.js";

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
    // Server-level enableSpotlighting is authoritative across all
    // tool paths and must NOT be overridable via options.generatorConfig.
    // Set after the spread so a generatorConfig cannot opt the YAML tools
    // out of spotlighting the built-in tools apply.
    enableSpotlighting: mergedConfig.enableSpotlighting,
    // Cleared for the same reason: the YAML tools take the server's own
    // policy, passed per call below, so a generatorConfig cannot open them
    // wider than curl_execute. A generatorConfig.baseUrl on another host
    // does not widen it either; that embedder sets allowedHosts.
    allowedHosts: void 0
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
      // Derived per call, not here: the server still accepts configure()
      // until start(), and getConfig() is the frozen config by the time a
      // tool can be called, which start() has already validated.
      (params, extra) => toolDef.handler(params, { ...extra, hostPolicy: deriveHostPolicy(server.getConfig()) })
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
