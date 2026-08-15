# IPC API Reference

*A short tour of the typed IPC handler registry used by the renderer and the local MCP bridge. The bridge exposes an explicit, secret-safe whitelist over these handlers rather than the complete renderer surface.*

## Prerequisites

None. This is a reference doc for users who need to find an IPC handler or an MCP tool quickly.

## Where to Find the Full Reference

The renderer talks to the main process through a single typed channel exposed by `app/electron/preload.ts`. Every IPC call is a `domain.action` name on that channel, and the handler registry routes it to the right service call. The authoritative channel list is `registerAllHandlers` in `app/core/ipc/handlers/index.ts`; the MCP-visible subset is `MCP_TOOLS` in `app/core/mcp/tools.ts`.

For the local MCP bridge, the per-tool schema is in the running server's `tools/list` response. Treat the per-tool signature as the source of truth; the surface evolves.

## Surface Shape

The IPC surface is grouped by resource. Every operation is a typed envelope with a single channel name. MCP tool names use the same groups, but only handlers listed in `app/core/mcp/tools.ts` are exposed.

| Group | Channel prefix | What it covers |
|-------|---------------|----------------|
| Workspaces | `workspaces.*` | CRUD for local workspaces |
| Workflows | `workflows.*` | CRUD, project attachment, selected environment, plus OpenAPI/HAR/cURL import and `.awecollection` export/import/dry-run |
| Runs | `runs.*` | Create, metadata/results, per-node result, lists, latest, cancel, renderer artifact actions |
| Projects | `projects.*` | CRUD, workflow membership, `.awecollection` export/import/dry-run |
| Environments | `environments.*` | CRUD and variable mutation, including the `baseEnvironmentId` inheritance link |
| Node presets | `nodePresets.*` | Workspace-scoped library of reusable node configurations (create, list, update, delete) |
| Secrets | `secrets.*` | Metadata reads plus sealed-box writes for trusted renderer IPC |
| Assertions | `assertions.*` | Suggest, validate, and apply assertion rules |
| Settings | `settings.*` | App settings reads and the private-networks opt-in |
| Cloud | `cloud.*` | Optional Cloud sync: status, link, bind, pull, push, conflict and dead-letter handling |

The renderer never calls services directly. Every renderer call routes through a handler in `app/core/ipc/handlers/`, and the handler delegates to a service. The MCP bridge follows the same rule: every tool call maps to a handler, and the handler delegates to the same service.

## Handler Groups

| Group | Path | What it covers |
|-------|------|----------------|
| Workflows | `app/core/ipc/handlers/workflows.ts` | List, get, create, update, patch, delete, diagnose, project attachment, selected environment |
| Imports | `app/core/ipc/handlers/imports.ts` | OpenAPI/Swagger/HAR/cURL import, `.awecollection` export/import/dry-run, template saving |
| Runs | `app/core/ipc/handlers/runs.ts` | Create, get, getNodeResult, list, latest, latest failed, cancel, renderer artifact actions |
| Projects | `app/core/ipc/handlers/projects.ts` | CRUD, workflow membership, export, import, import dry-run |
| Environments | `app/core/ipc/handlers/environments.ts` | List, get, create, update, delete, setVariable, deleteVariable |
| Node presets | `app/core/ipc/handlers/node-presets.ts` | Create, list, update, delete; config canonicalised and validated per node type |
| Secrets | `app/core/ipc/handlers/secrets.ts` | Metadata list/resolve, sealed-box set, delete, public key |
| Assertions | `app/core/ipc/handlers/assertions.ts` | Suggest, validate, and apply assertion rules |
| Settings | `app/core/ipc/handlers/settings.ts` | Settings reads and the private-networks opt-in |
| Cloud | `app/core/ipc/handlers/cloud.ts` | Status, link/cancel/unlink, workspace binding, push/pull, conflicts, dead letters |
| Workspaces | `app/core/ipc/handlers/workspaces.ts` | List, get, create, update, delete |
| Common | `app/core/ipc/handlers/common.ts` | Shared types, error shapes, helpers |
| Index | `app/core/ipc/handlers/index.ts` | Registration entry point for `registerAllHandlers` |

## Common Patterns

**Authentication.** There is no per-call auth between the renderer and the main process. The preload script is the only bridge: the renderer cannot call arbitrary Node.js APIs. The desktop app is single-user on this machine; work is organized into local workspaces, and cross-machine collaboration is handled by an optional APIWeave Cloud account, not by the local IPC surface. The MCP bridge uses a static per-install token; see [MCP Integration](../features/mcp-integration.md).

**Error format.** Every error returns a JSON shape: `{"error": {"code": "string", "message": "string", "details": {...}}}`. The IPC contract has four codes: `not_found`, `validation`, `conflict`, and `denied`. HTTP status codes appear only at the MCP transport boundary, where the HTTP server maps failures onto statuses such as 400, 401, 403, 404, 405, 413, and 503.

**Write-only secrets.** Secret write channels accept a Libsodium sealed-box payload encrypted against the install's public key. The plaintext value never crosses the IPC boundary. Secret read channels return metadata only. There is no API to read a stored secret value back.

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
