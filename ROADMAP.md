# Roadmap

This roadmap is subject to change. The current product is the local-first
Electron desktop app; optional APIWeave Cloud sync and collaboration run as a
separate Cloud control plane. Priorities shift based on user feedback.

## Shipped

The local-first desktop rewrite. Single Electron process: ReactFlow canvas,
six node types, workflow variables and extractors, projects with `.awecollection`
export (references only), explicit per-run environment selection, the encrypted
local secret store with `environment > workspace` scope chain, in-process runner with
resume and lineage, the opt-in local MCP bridge, OpenAPI/Swagger/HAR/cURL
import, and optional APIWeave Cloud structure sync. See the
[Changelog](CHANGELOG.md) for the full current surface.

## Next

- **Workflow history.** A per-workflow diff view across revisions, using the
  canvas auto-save as the source of truth.
- **Cloud conflict resolution UI on desktop.** When Cloud structure sync is connected,
  surface the conflict queue and the Local copy vs Cloud copy comparison from
  the Cloud Conflict Center on the desktop, with Keep local / Keep Cloud actions
  that apply the chosen outcome through the sync transport.
- **MCP tool surface expansion.** Additional local-only MCP tools that map to
  existing IPC handlers, staying inside the loopback bridge and the per-install
  token model.
- **Environment editing improvements.** Bulk variable import and clearer
  reference-check messaging when an environment is still attached to a workflow
  and cannot be deleted.

## Later

- **Local scheduling.** Locally scheduled runs per workflow or project, run by
  the in-process scheduler on the user's machine. No remote trigger, no
  webhook, no public port.
- **Project templates.** Export a project as a reusable local template, with
  references only and no secret material.
- **Cross-machine collaboration polish.** Sharing, roles, and conflict
  workflows that build on the optional Cloud account and the
  desktop-org → Cloud-Team / desktop-team → Cloud-Workspace mapping.

## Out of scope

The following were explored in earlier builds and are explicitly out of scope
for the desktop app. They either contradict the local-first boundary or belong
to the optional Cloud control plane rather than the desktop process:

- Webhooks or remote triggers. Runs start from the UI, a local scheduler, or
  the local MCP bridge.
- Hosted execution or cloud-side run history. Cloud never builds or runs tests.
- Real-time canvas collaboration. The desktop canvas is single-user on the
  machine it runs on.
- An append-only audit log, scoped service tokens, and environment protection
  with required reviewers. These were part of the retired web surface.
- A Docker Compose self-hosting stack. There is no server to host.

## How to influence

Open or comment on a [GitHub Issue](https://github.com/apiweave/apiweave/issues)
with your use case. The roadmap above shifts toward the work the community asks
for first.