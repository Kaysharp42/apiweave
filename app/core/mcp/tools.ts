import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { MCP_GUIDES } from "./guide"

/**
 * The agent-facing MCP tool surface — an explicit whitelist over the IPC handler
 * registry, NOT an auto-expose-everything. Each entry names a `{domain}.{action}`
 * that already exists as an IPC handler; the bridge (`bridge.ts`) turns each into
 * an MCP tool named `${domain}_${action}` that dispatches through the same router,
 * so parity and secret-safety are inherited from the service path (Task 13 proved
 * reads return refs + metadata only, never plaintext).
 *
 * Deliberately EXCLUDED (documented so the whitelist test can assert their absence):
 *  - `secrets.set`, `secrets.delete`, `secrets.duplicate`, `secrets.moveToScope` — keystore
 *    mutations; MCP secret surface is read-only metadata (`list`, `resolve`), matching the
 *    Python "metadata-only" posture. Duplicate/move carry sealed BYTES between scopes, so
 *    exposing them would let an agent re-home a credential it is not allowed to read.
 *  - `runs.report`, `projects.runReport` — a whole JUnit or HTML report as one
 *    unbounded string for the renderer to save; an agent reads the same facts,
 *    bounded, through `runs_get`, `runs_getNodeResult` and `projects_getRun`.
 *  - `runs.createIterations` — the renderer's "Run with data…": a background
 *    run per row. An agent runs a data set one row per `runs_create` (`data`),
 *    and waits on each, so every iteration gets its own approval and summary.
 *  - `runs.delete`, `runs.clearHistory` — irreversible deletion of run
 *    history; the user's call from the History panel, never an agent's.
 *  - `runs.listByWorkflow`, `runs.listByWorkspace`, `runs.getLatest`,
 *    `runs.getLatestFailed` (phase 6) — superseded by `runs.history`, which already
 *    filters by workspace/workflow/status with newest-first keyset pagination: the
 *    latest run is `history` with `workflowId` and `limit: 1`, the latest failure
 *    adds `status: "failed"`. The IPC handlers stay for the renderer and the
 *    debug-context service; they are just no longer separate agent tools.
 *  - `projects.listWorkflows` (phase 6) — returned an unbounded full-workflow
 *    array; superseded by `workflows.search` with `collectionId`, which pages
 *    graph-free summaries. The IPC handler stays for the renderer's project page.
 *  - `workflows.getRevision`, `workflows.restoreRevision` — an earlier version's
 *    whole graph (no MCP read redacts it like `workflows_get` does), and a write
 *    that replaces the workflow with it. Version history is the user's: an agent
 *    lists revisions (`workflows_listRevisions`) and points the user at it.
 *  - `projects.addWorkflow`, `projects.removeWorkflow` (phase 6) — project-centric
 *    duplicates of `workflows.attachToCollection`, which attaches AND detaches
 *    (nullable `collectionId`) in one workflow-centric tool. The IPC handlers
 *    stay for the renderer's project flows.
 *  - `workflows.update` — whole-graph replace, superseded for agents by
 *    `workflows_patch` (subset change by id, including name/description/tags)
 *    plus `workflows_create`; project and environment have their own write
 *    tools. Every copy of it also re-advertised the node union. The IPC
 *    handler stays: it is the renderer's save path.
 *  - `guides.list` — removed outright: `server_info` already lists every guide,
 *    and `guides_get` reads one for clients without resources.
 * Webhook and import tools are excluded structurally: they were never ported to the
 * IPC registry (dropped/deferred), so they cannot appear here.
 */
export interface McpToolSpec {
  readonly domain: string
  readonly action: string
  /** Stable public MCP name. Defaults to `${domain}_${action}`. */
  readonly name?: string
  readonly intent: "read" | "write"
  readonly destructive?: boolean
  readonly idempotent?: boolean
  readonly openWorld?: boolean
  /** Apply a compact MCP DTO after the shared IPC response sanitizer. */
  readonly resultProjection?: "run" | "workflowWrite" | "workflowSearch" | "runHistory"
  /**
   * Run `workflows.diagnose` on the written workflow and return the compact report
   * alongside the compact write result. Set on every tool that writes a graph: a graph with a
   * missing edge handle or an unaddressable assertion path saves cleanly and
   * only misbehaves at run time, so without this the cheapest way for an agent
   * to discover the mistake is to fire real HTTP requests at someone's API.
   */
  readonly diagnoseAfterWrite?: boolean
  /**
   * Writes that change graph topology (new/removed nodes, edges, edge handles,
   * group membership) are laid out once inside the service write path, on the
   * revision being saved. Set on every tool that can add/replace nodes, so an
   * agent that never reasons about `position` doesn't leave nodes stacked at
   * (0,0). Config/label-only writes never move the canvas. Skipped per-call by
   * passing `layout: false`. Kept as documentation: the layout itself lives in
   * `WorkflowService`, which sees the stored unredacted graph and the merged
   * patch together.
   */
  readonly autoLayout?: boolean
  /**
   * Advertise `_meta: {"anthropic/alwaysLoad": true}` so Claude Code loads the
   * tool up front instead of deferring it behind tool search. Only for the few
   * tools nearly every session calls, and only while their schemas stay small:
   * an always-loaded tool's whole input schema is paid on every session.
   */
  readonly alwaysLoad?: boolean
  /**
   * Surfaced to the LLM via `tools/list` — the one thing the IPC registry
   * lacks. Lead with the words an agent would search for: Claude Code's tool
   * search reads only the start of each description.
   */
  readonly description: string
}

function tool(
  domain: string,
  action: string,
  intent: McpToolSpec["intent"],
  description: string,
  options: Omit<McpToolSpec, "domain" | "action" | "intent" | "description"> = {},
): McpToolSpec {
  return { domain, action, intent, description, ...options }
}

export const MCP_TOOLS: readonly McpToolSpec[] = [
  // Workspaces
  tool("workspaces", "list", "read", "List all workspaces."),
  tool("workspaces", "get", "read", "Get a workspace by id."),
  tool("workspaces", "create", "write", "Create a workspace."),
  tool("workspaces", "update", "write", "Update a workspace's name or settings.", { idempotent: true }),
  tool("workspaces", "delete", "write", "Delete a workspace and its contents.", { destructive: true, idempotent: true }),
  tool("workspaces", "map", "read", "Workspace map: every workflow's endpoints (METHOD /path), variables produced and consumed, env and secret reference names, sub-workflow calls and last run status, paged. Names and path templates only, never values. Orient here in an unfamiliar workspace."),

  // Workflows — discovery is graph-free summaries (workflows_search), never full
  // graphs; structure reads are outline/node views (workflows_get). The raw
  // `workflows.list` IPC stays for the renderer's workspace tab but is not an
  // agent tool: finding a workflow must not transfer every graph.
  tool("workflows", "search", "read", "Find workflows by name, project (collectionId) or tags. Returns graph-free summaries — workflowId, rev, project, node/edge counts — never configs or graphs. Searches project-attached workflows too unless collectionId narrows to one project. Start here before reading or editing a workflow.", { resultProjection: "workflowSearch", alwaysLoad: true }),
  tool("workflows", "get", "read", "Read a workflow's structure or node configs. view outline (the default): node ids/types/labels and edges, no configs, paged with nextNodeCursor — nodeCount/edgeCount describe the whole graph and omittedNodeCount/omittedEdgeCount what the page leaves out. view nodes with nodeIds: full configs of up to 50 nodes plus incident edges. view full: the whole graph, refused above 64 KiB. Partial views are marked partial:true. Credential values come back as `<SECRET>`; `{{secrets.NAME}}` references stay verbatim.", { alwaysLoad: true }),
  tool("workflows", "searchNodes", "read", "Find nodes by route, label, type or reference, in one workflow or — workflowId omitted — the whole workspace. query: literal substring of nodeId, label, type, method, URL path or extractor name. ref: nodes using {{variables.x}}, {{env.X}} or {{secrets.X}}, marked produces or consumes. Matches carry method and urlPath; values are never inspected or returned."),
  tool("workflows", "diagnose", "read", "Check a stored workflow statically — topology, assertion paths, edge handles, variable provenance — and, with a `runId`, correlate a past run's failures. Sends no HTTP and changes nothing: find graph mistakes here, not with a live run. Codes are explained in `apiweave://guide/diagnostics`.", { name: "workflow_diagnose" }),
  tool("workflows", "debugContext", "read", "Debug a failed run in one bounded read: workflow rev; the chosen run (runId, otherwise the latest failed — stated in runSelection); failed/blocked nodes with run-correlated diagnosis; configs of up to 5 failed nodes plus their nearest dependencies and incident edges; unresolved placeholders; environment key presence; secret names and resolution metadata (never values); truncated error evidence with runs_getNodeResult selectors. Held to 32 KiB: overflow moves to omittedNodeIds/nextReads, counts still cover every failure. runRev is the run record's revision, never the workflow rev; graphCorrelation says whether the run executed the current workflow rev (current, stale or unknown).", { alwaysLoad: true }),
  tool("assertions", "suggest", "read", "Suggest assertion rules from one stored HTTP result — the reliable way to get paths right, since they come from a response that actually happened. Returns candidates with stable ids, rules and overfit warnings, plus the workflow's current `rev` for assertion_apply's expectedRevision. Needs a completed run of that node; before one exists, write rules by hand and check them with assertion_validate. Never modifies the workflow.", { name: "assertion_suggest" }),
  tool("assertions", "validate", "read", "Validate assertion rules and preview them in plain language, with per-rule issues, without changing the workflow. For previews, evidence checks against a runId, or user approval. Canonicalizes what it accepts (a `prev` path gains its `response.` prefix, array indexes use [0]): pass the returned `rules` to assertion_apply.", { name: "assertion_validate" }),
  tool("assertions", "apply", "write", "Apply assertion rules to one existing assertion node, when `expectedRevision` still matches the workflow's `rev`. Validates shape itself — a separate assertion_validate is only for previews or approval; pass runId to also check rules against stored run evidence. Array paths use [0] (response.body.items[0].id).", { name: "assertion_apply", resultProjection: "workflowWrite", diagnoseAfterWrite: true }),
  tool("guides", "get", "read", `Read an authoring guide by slug (${MCP_GUIDES.map((guide) => guide.slug).join(", ")}) — the same text as its apiweave://guide/ resource, for clients that cannot read resources.`),
  tool("workflows", "nodeSchema", "read", "Node config schema: the JSON Schema of one node type's config (http-request, sse, assertion, …), plus what the type does and its edge handles. The write tools advertise config as an open object, so read this before writing a node type you have not used here."),
  tool("workflows", "create", "write", "Create a workflow from nodes, edges and variables. Call workflows_nodeSchema for a node type's config fields; a bad config is rejected with its node's index in the error path. Check the returned diagnosis before running. A `workflow` node runs another workflow in the same workspace as one step. New graphs are laid out automatically; `layout: false` keeps the positions sent. First graph here? Read `apiweave://guide/workflow-authoring`.", { diagnoseAfterWrite: true, autoLayout: true, resultProjection: "workflowWrite" }),
  tool("workflows", "patch", "write", "Edit a workflow by id: upsertNodes, upsertEdges, removeNodeIds, removeEdgeIds, setVariables/unsetVariables, and name, description or tags. Pass expectedRevision from the rev you last read to reject stale edits. Insert a node and rewire it in ONE patch — the new node, old edge removals and replacement edges together — so the saved branch stays connected. Existing nodes merge recursively; new nodes need type and complete config: call workflows_nodeSchema for a type's config fields. `parentId` moves a node into a group (null takes it out). Returns touched ids and one diagnosis. Topology changes are laid out automatically; config/label-only patches keep every position; `layout: false` keeps positions as sent.", { idempotent: true, diagnoseAfterWrite: true, autoLayout: true, resultProjection: "workflowWrite", alwaysLoad: true }),
  tool("workflows", "layout", "write", "Re-lay-out a workflow's node positions with dagre (layered left-to-right or top-to-bottom) without changing anything else — for nodes left stacked or overlapping by an import or an older graph.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "delete", "write", "Delete a workflow.", { destructive: true, idempotent: true }),
  tool("workflows", "listRevisions", "read", "List a workflow's earlier versions, newest first: when each was kept, its node/edge counts, and the write it preceded (`canvas`, `agent:<name>`, `cloud`, `import`, `restore`). The workflow as it was before your edits is always kept (consecutive writes from you within ten minutes share one version), so a bad edit can be undone — the user restores a version from Version history in APIWeave; there is no restore tool. Metadata only, never content."),
  tool("workflows", "attachToCollection", "write", "Attach a workflow to a project, or detach it with collectionId null — the project-membership write.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "setEnvironment", "write", "Set or clear the environment a workflow runs against.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "moveToWorkspace", "write", "Move a workflow into another workspace, optionally attaching it to a project there (`targetCollectionId`, or null for unassigned). Its selected environment is cleared and any `workflow` node targeting a workflow left behind loses that target — references resolve within a workspace, so they cannot follow. Confirm with the user before calling: moving it back recovers none of this.", { destructive: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),

  // Projects — membership reads/writes go through the workflow tools:
  // `workflows_search` with `collectionId` lists what a project contains as paged
  // summaries, and `workflows_attachToCollection` attaches/detaches. The
  // project-centric IPC handlers stay for the renderer; they are not agent tools.
  tool("projects", "list", "read", "List projects in a workspace."),
  tool("projects", "get", "read", "Get a project by id."),
  tool("projects", "create", "write", "Create a project."),
  tool("projects", "update", "write", "Update a project.", { idempotent: true }),
  tool("projects", "delete", "write", "Delete an empty project.", { destructive: true, idempotent: true }),
  tool("projects", "run", "write", "Run a project: its enabled workflows one after another, in the project's saved order, all against one environment (`environmentId`, or null for none). Returns at once with the project run `running`; read progress with projects_getRun. Each workflow is an ordinary run — inspect one with runs_get using its item's runId. A failed workflow stops the project unless its row has continueOnFail, and the workflows after a stop are skipped; any failure fails the project. Variables do not pass between workflows. A workflow run that would send stored secrets first waits for the user to approve it in APIWeave, exactly as runs_create does; a denial fails that workflow — tell the user, do not retry.", { openWorld: true }),
  tool("projects", "getRun", "read", "Get a project run: its status, and each workflow's status (pending, running, completed, failed, cancelled, interrupted, skipped), runId and duration, in run order."),
  tool("projects", "listRuns", "read", "List a project's runs, newest first. The newest 50 finished runs of a project are kept."),
  tool("projects", "cancelRun", "write", "Cancel a running project run: its current workflow run is cancelled and the workflows after it are skipped.", { destructive: true, idempotent: true }),
  tool("projects", "moveToWorkspace", "write", "Move a project and every workflow in it into another workspace. Each moved workflow's selected environment is cleared, and calls out to a workflow left behind lose their target; calls between workflows in this project survive. Confirm with the user before calling.", { destructive: true }),

  // Environments
  tool("environments", "list", "read", "List environments in a workspace."),
  tool("environments", "get", "read", "Get an environment by id."),
  tool("environments", "create", "write", "Create an environment. Set `baseEnvironmentId` to inherit plain variables from another environment in the same workspace."),
  tool("environments", "update", "write", "Update an environment, including its `baseEnvironmentId` (null clears inheritance).", { idempotent: true }),
  tool("environments", "delete", "write", "Delete an environment.", { destructive: true, idempotent: true }),
  tool("environments", "setVariable", "write", "Set a variable on an environment, read back as `{{env.NAME}}` — NOT `{{secrets.NAME}}`. Secrets are a separate keystore MCP cannot write to (see `secrets_list`/`secrets_resolve`); a token set here is a plain environment variable, whatever its name suggests.", { idempotent: true }),
  tool("environments", "deleteVariable", "write", "Delete a variable from an environment.", { destructive: true, idempotent: true }),
  tool("environments", "duplicate", "write", "Copy an environment — into its own workspace, or into another one with `targetWorkspaceId`. Variables and description are copied; SECRETS ARE NOT, so a copy whose requests authenticate through `{{secrets.NAME}}` has nothing to resolve until those are set again on the copy. The copy is never the workspace default, and a cross-workspace copy leaves `baseEnvironmentId` behind — a base environment must live in the same workspace as the one extending it."),
  tool("environments", "moveToWorkspace", "write", "Move an environment into another workspace. Workflows that had it selected lose that selection, environments that extend it lose the link, and it gives up its own base environment and its default flag — a workspace is the scope all three resolve in, so none can follow. Its environment-scoped secrets do travel with it. Confirm with the user before calling: moving it back does not restore the cleared references.", { destructive: true }),

  // Node presets — the workspace's reusable node configurations. Reads come back
  // through the same blanket redaction every other MCP read gets, so a preset
  // built from a real request reports `<SECRET>` for its body, URL and headers:
  // an agent can catalogue and author presets, but cannot re-emit a redacted one
  // into a workflow. Dragging a preset onto a canvas stays a desktop action.
  tool("nodePresets", "list", "read", "List a workspace's saved node presets (reusable node configurations). Config values are redacted like any other MCP read."),
  tool("nodePresets", "create", "write", "Save a reusable node preset in a workspace from a name, node type and config."),
  tool("nodePresets", "update", "write", "Update a saved node preset's name, node type or config.", { idempotent: true }),
  tool("nodePresets", "delete", "write", "Delete a saved node preset.", { destructive: true, idempotent: true }),

// Runs — history is the one query operation for workspace/workflow/status/latest
// filtering (newest first): the latest run is history with workflowId + limit 1,
// the latest failure adds status failed. Single-run reads stay granular.
  tool("runs", "create", "write", "Run a workflow — sends real HTTP requests to a real service. Waits up to waitMs (default 10s) and returns a compact summary with failure details, or terminal:false and a runId for runs_wait on deadline; a wait timeout or disconnect never cancels the run (runs_cancel does). operationId makes retries safe. A run that would send stored secrets first waits up to 2 minutes for the user to approve it in APIWeave (status running — keep calling runs_wait); deniedByUser:true means they refused or did not answer — tell the user, do not retry. `resume` reruns part of a workflow after a fix: `{ nodeId }` starts there, `{}` reruns the steps the latest run failed.", { openWorld: true, resultProjection: "run", alwaysLoad: true }),
  tool("runs", "wait", "read", "Wait up to waitMs (default 10000, max 30000; 0 re-reads immediately) for one run to finish, event-driven with no polling. Returns the compact final summary with failure details on completion, or the current status with terminal:false and the same runId for another wait on deadline. Cancelling the wait never cancels the run.", { idempotent: true, resultProjection: "run" }),
  tool("runs", "get", "read", "Get a metadata-only run snapshot: status, timing, per-status node counts and failed-node details (expected status, unresolved placeholders), never per-node results — use runs_getNodeResult for evidence. Its `runRev` is only this run record's revision, never a workflow revision; use workflows_get's `rev` for expectedRevision.", { resultProjection: "run" }),
  tool("runs", "getNodeResult", "read", "Inspect run evidence for up to 50 nodes: pick sections (error, assertions, extractors, request, response), select within a JSON response body by extractor-grammar path, and window text previews. Bodies travel as capped previews with explicit truncation accounting, never whole; the page is held to 32 KiB and over-budget previews are marked budgetOmitted for a single-node refetch. Unknown ids are reported as missing; skipped sections are named in omittedSections. Secret values are redacted like every other MCP read.", { name: "runs_getNodeResult" }),
  tool("runs", "history", "read", "Run history for a workspace or one workflow, newest first: runId, status, startedAt, durationMs and failedNodeCount per row (failedNodes when non-empty), never per-node results. Filter by workflowId or status; the latest run is limit 1, the latest failure adds status failed.", { resultProjection: "runHistory" }),
  tool("runs", "cancel", "write", "Cancel a queued or running run and return its metadata-only snapshot.", { destructive: true, idempotent: true, resultProjection: "run" }),

  // Secrets — read-only metadata surface (never plaintext, never sealed bytes)
  tool("secrets", "list", "read", "List secret metadata (names/scopes) for a scope. Never returns secret values."),
  tool("secrets", "resolve", "read", "Resolve which scope a secret name binds to. Returns metadata only, never the value."),

  // Projects — export/import (references only, fail-closed on plaintext)
  tool("projects", "export", "read", "Export a collection bundle (secret references only, no values)."),
  tool("projects", "dryRun", "read", "Preview importing a bundle without writing."),
  tool("projects", "import", "write", "Import a collection bundle into a workspace."),
]

export const MCP_SERVER_INFO_TOOL = {
  name: "server_info",
  description:
    "Server name, version, transport, and the authoring guides (URI, title, description). Read `apiweave://guide/start-here` (or guides_get) before building or editing a workflow — it covers the conventions the tool schemas alone do not.",
  intent: "read",
} as const

/** The MCP tool name for a spec: `${domain}_${action}` (camelCase surface, mirrors the IPC contract). */
export function toolName(spec: McpToolSpec): string {
  return spec.name ?? `${spec.domain}_${spec.action}`
}

export function toolAnnotations(
  spec: Pick<McpToolSpec, "intent" | "destructive" | "idempotent" | "openWorld">,
): ToolAnnotations {
  return {
    readOnlyHint: spec.intent === "read",
    destructiveHint: spec.destructive ?? false,
    idempotentHint: spec.intent === "read" || (spec.idempotent ?? false),
    openWorldHint: spec.openWorld ?? false,
  }
}
