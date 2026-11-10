# Roadmap

This roadmap is subject to change. The current product is the local-first
Electron desktop app, with git sync of a workspace — tracking, a remote, sync
status in the header, and a merge view for settling clashes. Priorities shift
based on user feedback.

## Shipped

**The 1.0 surface.** Single Electron process: ReactFlow canvas, eight executable
node types plus note and group annotations, workflow variables and extractors,
projects with `.aweproject` v2 export (references only), explicit per-run
environment selection, the encrypted local secret store with the
`environment > workspace` scope chain, the in-process runner, OpenAPI, Swagger,
HAR and cURL import, and auto-update through the GitHub release channel.

**Reuse primitives (v0.6.0):** a **Call Workflow** node that runs another
workflow inline as one step, **environment inheritance** from a base environment
for plain variables, and a workspace-scoped **node preset** library. Presets
and base environments sync with a tracked workspace's repository since 1.0.

**Testing and observability (v0.7.x):** **expected status** on HTTP Request
nodes for negative tests, the **visualization and debugging** surface (run
timeline, variable provenance, secret resolution confidence), and the **run
camera** that follows the active branch during runs.

**Rerun and undo (v0.12.0):** **run from a node** and **rerun failed branches**,
reusing the upstream results and variables of an earlier run, and **version
history** for every workflow, restoring an earlier version after a bad save,
agent edit or import.

**Teams and CI (v0.12.0):** **one-click project runs** with live progress, the
headless **`apiweave run`** CLI with JUnit and HTML reports, **data-driven runs**
from CSV or JSON, **Postman import**, OAuth 2.0, Digest, AWS Signature V4 and JWT
auth, GraphQL bodies, sandboxed pre-request and post-response scripts, schema
and contract assertions, retry and polling, a per-run cookie jar, and proxy,
private CA and client-certificate support.

**Git sync (v0.20.0):** a workspace is tracked by a local git repository and
every change becomes a commit; `apiweave run` reads the repository, and a
workspace connected to a remote you own is kept in step from the header's sync
status. Two sides that both changed merge by record, node and field; real
clashes are settled in a merge view (which replaced the earlier per-field
picker), keeping either copy or a value you type.

**Agents and local automation (v0.21–v0.22):** sign in to GitHub or GitLab from
the header, create the workspace repository from the app, launch a coding agent
beside the canvas, keep the app in the tray so the MCP bridge and git sync stay
reachable, and give agents an outline-first, paged MCP surface.

**1.0 (v1.0.0):** signed and notarized desktop builds that update in place
(macOS Developer ID and Windows code signing when the release secrets are
configured), **base environments and node presets sync** with the workspace
repository (format version 2), **choosing the branch to track and switching it
later**, the standalone **`@apiweave/cli`** package attached to every release,
the **1.x compatibility policy** for MCP tools, repository files, bundles and
the CLI, opening an account's `apiweave-workspace`-tagged repositories after
signing in, and **GitHub profile pictures** in the accounts menu.

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
