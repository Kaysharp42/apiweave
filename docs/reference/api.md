# IPC API Reference

*A short tour of the typed IPC handler registry used by the renderer and the local MCP bridge. The bridge exposes an explicit, secret-safe whitelist over these handlers rather than the complete renderer surface.*

## Prerequisites

None. This is a reference doc for users who need to find an IPC handler or an MCP tool quickly.

## Where to Find the Full Reference

The renderer talks to the main process through a single typed channel exposed by `app/electron/preload.ts`. Every IPC call is a `domain.action` name on that channel, and the handler registry routes it to the right service call. The full channel map is regenerated at build time; check the running app's developer tools (the network/IPC panel) for the authoritative list.

For the local MCP bridge, the per-tool schema is in the running server's `tools/list` response. Treat the per-tool signature as the source of truth; the surface evolves.

## Surface Shape

The IPC surface is grouped by resource. Every operation is a typed envelope with a single channel name. MCP tool names use the same groups, but only handlers listed in `app/core/mcp/tools.ts` are exposed.

| Group | Channel prefix | What it covers |
|-------|---------------|----------------|
| Workspaces | `workspaces.*` | CRUD for local workspaces |
| Workflows | `workflows.*` | CRUD, project attachment, selected environment |
| Runs | `runs.*` | Create, metadata/results, lists, latest, cancel |
| Projects | `projects.*` | CRUD, workflow membership, `.awecollection` export/import |
| Environments | `environments.*` | CRUD and variable mutation |
| Secrets | `secrets.*` | Metadata reads plus sealed-box writes for trusted renderer IPC |

The renderer never calls services directly. Every renderer call routes through a handler in `app/core/ipc/handlers/`, and the handler delegates to a service. The MCP bridge follows the same rule: every tool call maps to a handler, and the handler delegates to the same service.

## Handler Groups

| Group | Path | What it covers |
|-------|------|----------------|
| Workflows | `app/core/ipc/handlers/workflows.ts` | List, get, create, update, delete, project attachment, selected environment |
| Runs | `app/core/ipc/handlers/runs.ts` | Create, get, list, latest, latest failed, cancel, renderer artifact actions |
| Projects | `app/core/ipc/handlers/projects.ts` | CRUD, workflow membership, export, import, import dry-run |
| Collections | `app/core/ipc/handlers/collections.ts` | Legacy alias surface; new code uses the projects group |
| Environments | `app/core/ipc/handlers/environments.ts` | List, get, create, update, delete |
| Secrets | `app/core/ipc/handlers/secrets.ts` | Metadata list/resolve, sealed-box set, delete, public key |
| Workspaces | `app/core/ipc/handlers/workspaces.ts` | List, get, create, update, delete |
| Common | `app/core/ipc/handlers/common.ts` | Shared types, error shapes, helpers |
| Index | `app/core/ipc/handlers/index.ts` | Registration entry point for `registerAllHandlers` |

## Common Patterns

**Authentication.** There is no per-call auth between the renderer and the main process. The preload script is the only bridge: the renderer cannot call arbitrary Node.js APIs. The desktop app is single-user on this machine; orgs and teams are a local organizing layer, and cross-machine collaboration is handled by an optional APIWeave Cloud account, not by the local IPC surface. The MCP bridge uses a static per-install token; see [MCP Integration](../features/mcp-integration.md).

**Error format.** Every error returns a JSON shape: `{"error": {"code": "string", "message": "string", "details": {...}}}`. Status codes follow REST conventions (400 for bad input, 404 for missing, 409 for conflicts, 422 for validation failures, 500 for server errors).

**Write-only secrets.** Secret write channels accept a Libsodium sealed-box payload encrypted against the scope's public key. The plaintext value never crosses the IPC boundary. Secret read channels return metadata only. There is no API to read a stored secret value back.

**Streamed events.** The runner publishes progress events to the renderer over a separate IPC channel. The renderer subscribes once on mount and unsubscribes on unmount. The renderer does not poll for status.

The same run transitions also reach MCP through a shared event broker: a session client that subscribes to the run resource receives `notifications/resources/updated` change signals and re-reads the snapshot, while simpler clients re-read the metadata-only `runs_get` tool while a run is active.

## Rate Limits

None at the IPC layer. The runner's outbound HTTP path enforces SSRF guards and per-host limits. The local MCP bridge has no call-rate limit, but it requires bearer authentication, validates browser origins, and rejects request bodies above 10 MB.

## Versioning

The IPC channel is unversioned. Channel names are stable; new arguments or new envelope fields are added without renaming existing channels. Breaking changes are documented in the project changelog and announced in release notes before the next tag is cut.

## Related

- [Documentation Hub](../README.md)
- [Architecture Reference](architecture.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [MCP Integration](../features/mcp-integration.md)
