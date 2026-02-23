# configs/

This directory holds your application-specific API definitions.

## Usage

1. Copy the template to create your API definition:

   ```bash
   cp configs/example.yaml.template configs/my-api.yaml
   ```

2. Edit the YAML file to define your API endpoints (see [YAML Schema Reference](../docs/api-schema.md))

3. Create an entry point that loads your definition:

   ```typescript
   import { createApiServer } from "mcp-curl";

   (async () => {
       const server = await createApiServer({
           definitionPath: "./configs/my-api.yaml",
       });
       await server.start("stdio");
   })();
   ```

   Run your server:

   ```bash
   npx tsx configs/my-api.ts
   ```

## What's gitignored

Files matching these patterns in `configs/` are **excluded from git**:

- `*.yaml`, `*.yml` — your API definitions
- `*.ts`, `*.js` — custom entry points

This means you can fork this repo, add your configs, and `git pull upstream main` without conflicts.

## What's tracked

- `README.md` — this file
- `example.yaml.template` — starting point for new definitions
- `.gitkeep` — ensures the directory exists in fresh clones

## References

- [YAML Schema Reference](../docs/api-schema.md) — full specification
- [examples/from-yaml/](../examples/from-yaml/) — working example project
- [Library Documentation](../docs/README.md) — full API reference
