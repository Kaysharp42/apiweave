# Reference

*Lookup pages for the moving parts of APIWeave: architecture, placeholder syntax, dynamic functions, environment variables, and the HTTP API surface. Use these docs to find a name, a default, or an endpoint, not to learn a workflow.*

## Prerequisites

None. Reference docs assume you already know what you are looking for. If you are new, start at the [Documentation Hub](../README.md).

## Architecture

- [Architecture](architecture.md): the four components (frontend, backend, worker, MongoDB) and how a workflow run moves through them.

## Placeholders and Functions

- [Placeholders](placeholders.md): the five placeholder namespaces (`{{variables}}`, `{{env}}`, `{{prev}}`, `{{secrets}}`, function calls) and the order the runner resolves them in.
- [Dynamic Functions](dynamic-functions.md): the 13 public functions you can call inside a placeholder (`uuid`, `randomString`, `timestamp`, `randomEmail`, and others), with signatures and examples.

## Configuration

- [Environment Variables](environment-variables.md): every variable the backend and frontend read, grouped by feature, with defaults and what each one controls.

## API Surface

- [API Reference](api.md): a short tour of the HTTP endpoint groups under `/api/*` and the MCP group under `/mcp`, with pointers to the live Swagger UI.

## When to Use These Docs

Reference docs are for lookup, not how-to. If you want to build a workflow, run a collection, or wire up a webhook, use the feature guides in `../features/` instead. Reach for this index when you have a specific name, default, or endpoint in mind and need to confirm its shape.

## Related

- [Documentation Hub](../README.md)
- [Concepts](../getting-started/concepts.md)
