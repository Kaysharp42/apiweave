# IPC API Reference

*A short tour of the typed IPC handler registry that backs both the renderer and the local MCP bridge. This is a map of the surface area, not a full reference. The handler registry is the single source of truth: the preload script exposes the same channel to the renderer, and the local MCP bridge maps tool calls to the same handlers.*

## Prerequisites

None. This is a reference doc for users who need to find an IPC handler or an MCP tool quickly.

## Where to Find the Full Reference

The renderer talks to the main process through a single typed channel exposed by `desktop/electron/preload.ts`. Every IPC call is a `domain.action` name on that channel, and the handler registry routes it to the right service call. The full channel map is regenerated at build time; check the running app's developer tools (the network/IPC panel) for the authoritative list.

For the local MCP bridge, the per-tool schema is in the running server's `tools/list` response. Treat the per-tool signature as the source of truth; the surface evolves.

## Surface Shape

The IPC surface is grouped by resource, and the renderer and the local MCP bridge share the same grouping. Every operation is a typed envelope with a single channel name.

| Group | Channel prefix | What it covers |
|-------|---------------|----------------|
| Workflows | `workflows.*` | CRUD, validation, run trigger, resume, add node |
| Runs | `runs.*` | Status, results, node results, cancel, latest failed |
| Projects | `projects.*` | CRUD, ordered run, `.awecollection` export and import |
| Environments | `environments.*` | CRUD, default flag, OpenAPI/Swagger URL |
| Secrets | `secrets.*` | Metadata-only read, Libsodium sealed-box write, rotate, delete, public key |
| MCP | `mcp.*` | Bridge status, token rotation, port, on/off toggle |
| App | `app.*` | Settings, about, version, log level |

The renderer never calls services directly. Every renderer call routes through a handler in `desktop/core/ipc/handlers/`, and the handler delegates to a service. The MCP bridge follows the same rule: every tool call maps to a handler, and the handler delegates to the same service.

## Handler Groups

| Group | Path | What it covers |
|-------|------|----------------|
| Workflows | `desktop/core/ipc/handlers/workflows.ts` | List, get, create, update, delete, add node, export, import, import dry-run, run, resume |
| Runs | `desktop/core/ipc/handlers/runs.ts` | Get status, get results, get node result, list, cancel, latest failed |
| Projects | `desktop/core/ipc/handlers/projects.ts` | List, get, create, update, delete, list workflows, add workflow, remove workflow, reorder, export, import, import dry-run, run |
| Collections | `desktop/core/ipc/handlers/collections.ts` | Legacy alias surface; new code uses the projects group |
| Environments | `desktop/core/ipc/handlers/environments.ts` | List, get, create, update, delete |
| Secrets | `desktop/core/ipc/handlers/secrets.ts` | List (metadata only), get (metadata only), write (sealed box), rotate (sealed box), delete, get public key |
| Workspaces | `desktop/core/ipc/handlers/workspaces.ts` | List, get, current |
| Common | `desktop/core/ipc/handlers/common.ts` | Shared types, error shapes, helpers |
| Index | `desktop/core/ipc/handlers/index.ts` | Registration entry point for `registerAllHandlers` |

## Common Patterns

**Authentication.** There is no per-call auth between the renderer and the main process. The preload script is the only bridge: the renderer cannot call arbitrary Node.js APIs. The desktop app is single-user on this machine; orgs and teams are a local organizing layer, and multi-user auth across machines is a future feature that arrives with an optional login system. The MCP bridge uses a static per-install token; see [MCP Integration](../features/mcp-integration.md).

**Error format.** Every error returns a JSON shape: `{"error": {"code": "string", "message": "string", "details": {...}}}`. Status codes follow REST conventions (400 for bad input, 404 for missing, 409 for conflicts, 422 for validation failures, 500 for server errors).

**Write-only secrets.** Secret write channels accept a Libsodium sealed-box payload encrypted against the scope's public key. The plaintext value never crosses the IPC boundary. Secret read channels return metadata only. There is no API to read a stored secret value back.

**Streamed events.** The runner publishes progress events to the renderer over a separate IPC channel. The renderer subscribes once on mount and unsubscribes on unmount. The renderer does not poll for status.

## Rate Limits

None at the IPC layer. The runner's outbound HTTP path enforces SSRF guards and per-host limits, but the IPC layer itself has no rate limit. The local MCP bridge has no rate limit because it is loopback-only.

## Versioning

The IPC channel is unversioned. Channel names are stable; new arguments or new envelope fields are added without renaming existing channels. Breaking changes are documented in the project changelog and announced in release notes before the next tag is cut.

## Related

- [Documentation Hub](../README.md)
- [Architecture Reference](architecture.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [MCP Integration](../features/mcp-integration.md)
