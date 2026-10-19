# Roadmap

This roadmap is subject to change. The current product is the local-first
Electron desktop app, with git sync of a workspace coming (see [Later](#later)).
Priorities shift based on user feedback.

## Shipped

The local-first desktop rewrite. Single Electron process: ReactFlow canvas,
eight node types, workflow variables and extractors, projects with `.awecollection`
export (references only), explicit per-run environment selection, the encrypted
local secret store with `environment > workspace` scope chain, in-process runner,
the opt-in local MCP bridge, OpenAPI/Swagger/HAR/cURL import, and auto-update
through the GitHub release channel. See the [Changelog](CHANGELOG.md) for the
full current surface.

Reuse primitives (v0.6.0): a **Call Workflow** node that runs another workflow
inline as one step, **environment inheritance** from a base environment for
plain variables, and a workspace-scoped **node preset** library. All three are
desktop-local for now — a preset never syncs.

Testing and observability (v0.7.x): **expected status** on HTTP Request nodes
for negative tests, the **visualization and debugging** surface (run timeline,
variable provenance, secret resolution confidence), and the **run camera** that
follows the active branch during runs.

Rerun and undo (1.0): **run from a node** and **rerun failed branches**, reusing
the upstream results and variables of an earlier run, and **version history**
for every workflow, restoring an earlier version after a bad save, agent edit
or import.

Teams and CI (1.0): **one-click project runs** with live progress, the headless
**`apiweave run`** CLI with JUnit and HTML reports, **data-driven runs** from CSV
or JSON, **Postman import**, OAuth 2.0, Digest,
AWS Signature V4 and JWT auth, GraphQL bodies, sandboxed pre-request and
post-response scripts, schema and contract assertions, retry and polling, a
per-run cookie jar, and proxy, private CA and client-certificate support.

## Next

- **MCP tool surface expansion.** Additional local-only MCP tools that map to
  existing IPC handlers, staying inside the loopback bridge and the per-install
  token model.
- **Environment editing improvements.** Clearer messaging when a workflow
  still points at a deleted environment.

## Later

- **Local scheduling.** Locally scheduled runs per workflow or project, run by
  the in-process scheduler on the user's machine. No remote trigger, no
  webhook, no public port.
- **Project templates.** Export a project as a reusable local template, with
  references only and no secret material.
- **Git sync.** A workspace will be tracked by a local git repository, and every
  change becomes a commit, so history is browsable with ordinary git tools and
  `apiweave run` reads the repo. Remotes and sharing follow, with conflicts
  resolved in the app — nothing hosted, nothing to sign in to.

## Out of scope

The following were explored in earlier builds and are explicitly out of scope
for the desktop app. They contradict the local-first boundary:

- Webhooks or remote triggers. Runs start from the UI, the local MCP bridge
  or the `apiweave run` CLI in your own CI; local scheduling is planned (see Later).
- Hosted execution or server-side run history. APIWeave never builds or runs
  your tests remotely.
- Real-time canvas collaboration. The desktop canvas is single-user on the
  machine it runs on.
- An append-only audit log, scoped service tokens, and environment protection
  with required reviewers. These were part of the retired web surface.
- A Docker Compose self-hosting stack. There is no server to host.

## How to influence

Open or comment on a [GitHub Issue](https://github.com/Kaysharp42/apiweave/issues)
with your use case. The roadmap above shifts toward the work the community asks
for first.
