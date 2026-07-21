# Reference

*Lookup pages for the moving parts of APIWeave: architecture, placeholder syntax, dynamic functions, environment variables, and the typed IPC surface. Use these docs to find a name, a default, or a channel, not to learn a workflow.*

## Prerequisites

None. Reference docs assume you already know what you are looking for. If you are new, start at the [Documentation Hub](../README.md).

## Architecture

- [Architecture](architecture.md): the components (renderer, Electron main process, IPC handler registry, repositories, runner, MCP bridge, embedded SQLite), and how a workflow run moves through them.

## Placeholders and Functions

- [Placeholders](placeholders.md): the four placeholder namespaces (`{{variables}}`, `{{env}}`, `{{prev}}`, `{{secrets}}`, function calls) and the order the runner resolves them in.
- [Dynamic Functions](dynamic-functions.md): the public functions you can call inside a placeholder (`uuid`, `randomString`, `timestamp`, `randomEmail`, and others), with signatures and examples.

## Configuration

- [Environment Variables](environment-variables.md): every variable the renderer reads, grouped by feature, with defaults and what each one controls.

## IPC Surface

- [IPC API](api.md): the typed IPC handler registry the renderer and the local MCP bridge call.

## When to Use These Docs

Reference docs are for lookup, not how-to. If you want to build a workflow, run a project, or wire up the local MCP bridge, use the feature guides in `../features/` instead. Reach for this index when you have a specific name, default, or channel in mind and need to confirm its shape.

## Related

- [Documentation Hub](../README.md)
- [Concepts](../getting-started/concepts.md)
