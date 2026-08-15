# Roadmap

This roadmap is subject to change. The current product is the local-first
Electron desktop app; optional APIWeave Cloud sync and collaboration run as a
separate Cloud control plane. Priorities shift based on user feedback.

## Shipped

The local-first desktop rewrite. Single Electron process: ReactFlow canvas,
seven node types, workflow variables and extractors, projects with `.awecollection`
export (references only), explicit per-run environment selection, the encrypted
local secret store with `environment > workspace` scope chain, in-process runner,
the opt-in local MCP bridge, OpenAPI/Swagger/HAR/cURL import, optional APIWeave
Cloud structure sync with desktop conflict resolution, and auto-update through
the GitHub release channel. See the [Changelog](CHANGELOG.md) for the full
current surface.

Reuse primitives (v0.6.0): a **Call Workflow** node that runs another workflow
inline as one step, **environment inheritance** from a base environment for
plain variables, and a workspace-scoped **node preset** library. All three are
desktop-local for now — a preset never syncs, and an environment's base link is
not yet part of the Cloud payload.

Testing and observability (v0.7.x): **expected status** on HTTP Request nodes
for negative tests, the **visualization and debugging** surface (run timeline,
variable provenance, secret resolution confidence), the **run camera** that
follows the active branch during runs, the **Private networks** opt-in for
LAN targets behind the SSRF guard, and sync **failure visibility** (dead-letter
records and real rejection reasons).

## Next

- **Workflow history.** A per-workflow diff view across revisions, using the
  canvas auto-save as the source of truth.
- **Resume after failure.** Expose the resume groundwork already in the runner
  (lineage links, start-node selection) as toolbar actions: run from a failed
  node, rerun failed branches, and continue.
- **One-click project runs.** Execute a project's enabled workflows in order
  under the per-row `continueOnFail` flag, producing one project run record.
- **MCP tool surface expansion.** Additional local-only MCP tools that map to
  existing IPC handlers, staying inside the loopback bridge and the per-install
  token model.
- **Environment editing improvements.** Bulk variable import and clearer
  messaging when a workflow still points at a deleted environment.

## Later

- **Local scheduling.** Locally scheduled runs per workflow or project, run by
  the in-process scheduler on the user's machine. No remote trigger, no
  webhook, no public port.
- **Project templates.** Export a project as a reusable local template, with
  references only and no secret material.
- **Cross-machine collaboration polish.** Sharing, roles, and conflict
  workflows that build on the optional Cloud account and its Cloud Teams and
  Cloud Workspaces.

## Out of scope

The following were explored in earlier builds and are explicitly out of scope
for the desktop app. They either contradict the local-first boundary or belong
to the optional Cloud control plane rather than the desktop process:

- Webhooks or remote triggers. Runs start from the UI or the local MCP bridge
  today; local scheduling is planned (see Later).
- Hosted execution or cloud-side run history. Cloud never builds or runs tests.
- Real-time canvas collaboration. The desktop canvas is single-user on the
  machine it runs on.
- An append-only audit log, scoped service tokens, and environment protection
  with required reviewers. These were part of the retired web surface.
- A Docker Compose self-hosting stack. There is no server to host.

## How to influence

Open or comment on a [GitHub Issue](https://github.com/Kaysharp42/apiweave/issues)
with your use case. The roadmap above shifts toward the work the community asks
for first.