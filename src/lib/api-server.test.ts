// src/lib/api-server.test.ts
// Integration tests for createApiServer

import { describe, it, expect } from "vitest";
import { createApiServer, createApiServerSync } from "./api-server.js";
import { loadApiSchemaFromString } from "./schema/index.js";

const SAMPLE_YAML = `
apiVersion: "1.0"

api:
  name: weather-api
  title: Weather API
  description: Get current weather data
  version: "1.0"
  baseUrl: https://api.weather.example.com/v1

auth:
  apiKey:
    type: query
    name: appid
    envVar: WEATHER_API_KEY
    required: false

defaults:
  timeout: 30
  headers:
    Accept: application/json

endpoints:
  - id: get_weather
    path: /weather
    method: GET
    title: Get Weather
    description: Get current weather for a city
    parameters:
      - name: city
        in: query
        type: string
        required: true
        description: City name
      - name: units
        in: query
        type: string
        enum:
          - metric
          - imperial
        default: metric
    response:
      jqFilter: ".main"
      filterPresets:
        - name: temp_only
          jqFilter: "{temp: .main.temp}"
        - name: full
          jqFilter: "."

  - id: get_forecast
    path: /forecast/{city_id}
    method: GET
    title: Get Forecast
    description: Get 5-day forecast for a city
    parameters:
      - name: city_id
        in: path
        type: integer
        required: true
        description: City ID
      - name: days
        in: query
        type: integer
        default: 5
`;

describe("createApiServer", () => {
    it("creates server from definition content", async () => {
        const server = await createApiServer({
            definitionContent: SAMPLE_YAML,
        });

        expect(server.isStarted()).toBe(false);
        expect(server.getConfig().baseUrl).toBe("https://api.weather.example.com/v1");
        expect(server.getConfig().defaultTimeout).toBe(30);
        expect(server.getConfig().defaultHeaders).toEqual({
            Accept: "application/json",
        });
    });

    it("creates server from pre-loaded schema", async () => {
        const schema = loadApiSchemaFromString(SAMPLE_YAML);
        const server = await createApiServer({
            schema,
        });

        expect(server.getConfig().baseUrl).toBe("https://api.weather.example.com/v1");
    });

    it("merges user config with schema config", async () => {
        const server = await createApiServer({
            definitionContent: SAMPLE_YAML,
            config: {
                maxResultSize: 1_000_000,
            },
        });

        expect(server.getConfig().maxResultSize).toBe(1_000_000);
        expect(server.getConfig().baseUrl).toBe("https://api.weather.example.com/v1");
    });

    it("allows disabling default tools", async () => {
        const server = await createApiServer({
            definitionContent: SAMPLE_YAML,
            disableCurlExecute: true,
            disableJqQuery: true,
        });

        // Server created successfully with default tools disabled
        expect(server.isStarted()).toBe(false);
    });

    it("throws when no schema source provided", async () => {
        // Use type assertion to test runtime error handling for JavaScript users
        // TypeScript's discriminated union now catches this at compile time
        await expect(createApiServer({} as never)).rejects.toThrow(
            "Must provide one of: definitionPath, definitionContent, or schema"
        );
    });
});

describe("createApiServerSync", () => {
    it("creates server from pre-loaded schema synchronously", () => {
        const schema = loadApiSchemaFromString(SAMPLE_YAML);
        const server = createApiServerSync(schema);

        expect(server.getConfig().baseUrl).toBe("https://api.weather.example.com/v1");
    });

    it("applies options correctly", () => {
        const schema = loadApiSchemaFromString(SAMPLE_YAML);
        const server = createApiServerSync(schema, {
            disableCurlExecute: true,
            config: {
                authToken: "test-token",
            },
        });

        expect(server.getConfig().authToken).toBe("test-token");
    });
});
