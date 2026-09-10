import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"

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
 *  - `runs.getArtifacts`, `runs.openArtifact`, `runs.saveArtifactAs` — Electron
 *    shell/dialog operations, not agent tools.
 *  - `runs.listByWorkflow`, `runs.listByWorkspace`, `runs.getLatest`,
 *    `runs.getLatestFailed` (phase 6) — superseded by `runs.history`, which already
 *    filters by workspace/workflow/status with newest-first keyset pagination: the
 *    latest run is `history` with `workflowId` and `limit: 1`, the latest failure
 *    adds `status: "failed"`. The IPC handlers stay for the renderer and the
 *    debug-context service; they are just no longer separate agent tools.
 *  - `projects.listWorkflows` (phase 6) — returned an unbounded full-workflow
 *    array; superseded by `workflows.search` with `collectionId`, which pages
 *    graph-free summaries. The IPC handler stays for the renderer's project page.
 *  - `projects.addWorkflow`, `projects.removeWorkflow` (phase 6) — project-centric
 *    duplicates of `workflows.attachToCollection`, which attaches AND detaches
 *    (nullable `collectionId`) in one workflow-centric tool. The IPC handlers
 *    stay for the renderer's project flows.
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
  readonly resultProjection?: "run" | "workflowWrite"
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
  /** One-line description surfaced to the LLM via `tools/list` — the one thing the IPC registry lacks. */
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

  // Workflows — discovery is graph-free summaries (workflows_search), never full
  // graphs; structure reads are outline/node views (workflows_get). The raw
  // `workflows.list` IPC stays for the renderer's workspace tab but is not an
  // agent tool: finding a workflow must not transfer every graph.
  tool("workflows", "search", "read", "Find workflows by name, project or tags. Returns graph-free summaries (ids, revision, ownership, node/edge counts) with an opaque cursor — never configs or graphs. Pages default 20 rows, max 100; nextCursor is present only when more rows exist, and a cursor issued against a changed list or different filters is rejected so you re-read without it. Searches project-attached workflows too, unless collectionId narrows to one project. Start here before reading or editing a workflow."),
  tool("workflows", "get", "read", "Read a workflow: view outline for bounded node ids/types/labels plus edge structure (no positions or configs; outline pages default 100 summaries, max 500, with nextNodeCursor; nodeCount/edgeCount always describe the whole graph and omittedNodeCount/omittedEdgeCount state what this page leaves out, so returned plus omitted accounts for every node on every page), view nodes for full configs of up to 50 named nodes plus incident edges and boundary-node identities, or view full for the whole graph. Partial views are marked partial:true. Node objects come back complete, but the output schema describes them as plain objects rather than repeating the per-type node union — read that union from the input schema of workflows_create/update/patch, which is where it is enforced. Credential values are withheld (`<SECRET>`), while `{{secrets.NAME}}` references remain verbatim. Prefer outline, then nodes, over full on a large workflow."),
  tool("workflows", "searchNodes", "read", "Locate nodes by label, type, request method, URL path or extractor name — a literal substring, never a regex. Bodies, headers, auth and values are never inspected, so this cannot match a withheld secret. Returns node ids plus neighbor and edge context for patching without a full read. Default 20 matches, max 100; totalMatched always describes every match and omittedMatchCount states what was left out."),
  tool("workflows", "diagnose", "read", "Statically check a stored workflow — topology, assertion paths and edge handles, variable provenance — and, with a `runId`, correlate a past run's failures. Side-effect-free and sends no HTTP: use it to find graph mistakes instead of discovering them with a live run. Read `apiweave://guide/diagnostics` for what each code means.", { name: "workflow_diagnose" }),
  tool("workflows", "debugContext", "read", "Explain one workflow's failure in a single bounded read: workflow identity with current rev, the chosen run (explicit runId, otherwise the latest failed run — stated in runSelection) with status and timestamps, failed/blocked node summary with run-correlated diagnosis, full configs of up to 5 relevant failed nodes plus their nearest dependencies with incident edges and handles, unresolved placeholders, selected-environment key presence with provenance, secret names plus run-recorded resolution metadata (never values), and truncated error evidence with runs_getNodeResult selectors for more. Held to a 32 KiB aggregate budget — over-budget details move to omittedNodeIds/nextReads with explicit continuation arguments, and counts still describe every failure. runRev is the run record's own revision, never the workflow rev; graphCorrelation stays unknown because runs do not record the executed workflow revision. Node configs come back complete, but the output schema describes nodes as plain objects rather than repeating the per-type node union — read that union from the input schema of workflows_create/update/patch, which is where it is enforced."),
  tool("assertions", "suggest", "read", "Propose verified assertion rules from one stored HTTP result — the reliable way to get paths right, since the rules are derived from a response that actually happened. Returns concise candidates with stable ids, rules and overfit warnings. Requires a completed run of that node; before one exists, author rules from the schema and check them with assertion_validate. Suggest never modifies the workflow; apply chosen rules explicitly with assertion_apply.", { name: "assertion_suggest" }),
  tool("assertions", "validate", "read", "Check assertion rules and return a human-readable preview plus per-rule issues, without changing the workflow. Use for previews, evidence checks against a runId, or explicit user approval. Canonicalizes what it accepts (a `prev` path gains its `response.` prefix, array indexes use [0]), so the returned `rules` are what assertion_apply should receive.", { name: "assertion_validate" }),
  tool("assertions", "apply", "write", "Apply rules to one assertion node when the workflow revision still matches. Returns a compact revision/touched-node result and diagnosis. Direct apply is correct when the user already specified the rules — a separate validate call is only needed for previews or approval. Validates shape itself; pass runId to also check rules against stored run evidence in the same call. Array paths use [0] (response.body.items[0].id). Pass `expectedRevision` from the workflow's current `rev`.", { name: "assertion_apply", resultProjection: "workflowWrite", diagnoseAfterWrite: true }),
  tool("guides", "list", "read", "List the authoring guides (same source as the apiweave://guide/ resources) for clients that cannot read resources. Slugs feed guides_get."),
  tool("guides", "get", "read", "Read one authoring guide by slug — the same text as the apiweave://guide/ resource, for clients that cannot read resources. Start with edit-debug for the repair loop."),
  tool("workflows", "create", "write", "Create a workflow from nodes, edges and variables. Returns revision/counts and one diagnosis (touched ids stay empty); check it before running. A `workflow` node runs another workflow in the same workspace as one step. Read `apiweave://guide/workflow-authoring` first if you have not built a graph here before. New graphs are laid out automatically; pass `layout: false` to keep the positions sent.", { diagnoseAfterWrite: true, autoLayout: true, resultProjection: "workflowWrite" }),
  tool("workflows", "update", "write", "Replace a workflow's graph, variables or metadata. `nodes` and `edges` are REPLACED wholesale, so send the complete lists; use workflows_patch to change a subset. Returns revision/counts and one diagnosis; touched ids stay empty. Topology changes (including retargeted edge handles) are laid out automatically; config/label-only replacements keep stored positions. Pass `layout: false` to keep the positions sent.", { idempotent: true, diagnoseAfterWrite: true, autoLayout: true, resultProjection: "workflowWrite" }),
  tool("workflows", "patch", "write", "Change part of a workflow with upsertNodes, upsertEdges, removeNodeIds and removeEdgeIds, and merge workflow variables. Insert a node and rewire its connections in ONE patch: include the new node, old edge removals and replacement edges together so the saved branch stays connected. Existing upserted nodes merge recursively; new nodes need type and complete config. Group membership is patchable both ways: set `parentId` to a group node's id to move a node into that frame, or `null` to take it out. Returns bounded touched IDs, revision/counts, and one diagnosis. Pass expectedRevision from the rev you last read to reject stale edits. See apiweave://guide/workflow-authoring for a complete insertion example. Topology changes (including retargeted edge handles) are laid out automatically on the saved revision; config/label-only patches keep every position. Pass layout: false to keep positions exactly as stored/sent.", { idempotent: true, diagnoseAfterWrite: true, autoLayout: true, resultProjection: "workflowWrite" }),
  tool("workflows", "layout", "write", "Re-lay-out a workflow's node positions with dagre (a layered left-to-right or top-to-bottom flow) without changing anything else. Returns revision/counts and one diagnosis; touched ids stay empty. Use this on a workflow whose nodes ended up stacked or overlapping — an import, or a graph built before this tool existed.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "delete", "write", "Delete a workflow.", { destructive: true, idempotent: true }),
  tool("workflows", "attachToCollection", "write", "Attach a workflow to a project, or detach it with collectionId null — this is the project-membership write. Returns revision/counts and one diagnosis; touched ids stay empty.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "setEnvironment", "write", "Set or clear the selected environment for a workflow. Returns revision/counts and one diagnosis; touched ids stay empty.", { idempotent: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),
  tool("workflows", "moveToWorkspace", "write", "Move a workflow into another workspace, optionally attaching it to a project there (`targetCollectionId`, or null to leave it unassigned). Its selected environment is cleared and any `workflow` node targeting a workflow left behind loses that target — a workspace is the scope those references resolve in, so they cannot follow. Returns revision/counts and one diagnosis; touched ids stay empty. Confirm with the user before calling: nothing here is recoverable by moving the workflow back.", { destructive: true, diagnoseAfterWrite: true, resultProjection: "workflowWrite" }),

  // Projects — membership reads/writes go through the workflow tools:
  // `workflows_search` with `collectionId` lists what a project contains as paged
  // summaries, and `workflows_attachToCollection` attaches/detaches. The
  // project-centric IPC handlers stay for the renderer; they are not agent tools.
  tool("projects", "list", "read", "List projects in a workspace."),
  tool("projects", "get", "read", "Get a project by id."),
  tool("projects", "create", "write", "Create a project."),
  tool("projects", "update", "write", "Update a project.", { idempotent: true }),
  tool("projects", "delete", "write", "Delete an empty project.", { destructive: true, idempotent: true }),
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
  tool("runs", "create", "write", "Trigger a workflow run. By default waits up to 10s (waitMs, max 30000; 0 returns immediately) and returns a compact summary with failure details on completion, or the current status with terminal:false and a reusable runId on deadline for runs_wait. Pass operationId to make retries safe: same id plus same request replays the first run instead of enqueueing again. A wait timeout or disconnect never cancels the run; use runs_cancel to stop it.", { openWorld: true, resultProjection: "run" }),
  tool("runs", "wait", "read", "Wait up to waitMs (default 10000, max 30000; 0 re-reads immediately) for one run to finish, event-driven with no polling. Returns the compact final summary with failure details on completion, or the current status with terminal:false and the same runId for another wait on deadline. Cancelling the wait never cancels the run.", { idempotent: true, resultProjection: "run" }),
  tool("runs", "get", "read", "Get a metadata-only run snapshot: status, timing, per-status node counts and failed-node details (expected status, unresolved placeholders), never per-node results — use runs_getNodeResult for evidence. Its `runRev` is only this run record's revision, never a workflow revision; use workflows_get's `rev` for expectedRevision.", { resultProjection: "run" }),
  tool("runs", "getNodeResult", "read", "Inspect bounded evidence for up to 50 nodes of a run: pick sections (error, assertions, extractors, request, response), select within a JSON response body by extractor-grammar path, and cap text previews (default 2048 bytes, max 8192; start/end select a text window). Bodies travel as previews with explicit truncation accounting, never whole; the page is held to a 32 KiB aggregate budget and over-budget previews are dropped and marked budgetOmitted for single-node refetch. Unknown ids are reported as missing; skipped sections are named in omittedSections; stored truncation is reported distinctly. The same secret-redaction pass every other MCP read applies.", { name: "runs_getNodeResult" }),
  tool("runs", "history", "read", "List compact run history for a workspace or one workflow: status, timing, failed-node counts and revision per row, never per-node results. Pages default 20 rows, max 100; nextCursor is present only when more rows exist, and a cursor issued against a changed history or different filters is rejected so you re-read without it. Filter by workflow or status. The latest run is history with workflowId and limit 1 (newest first); the latest failure adds status failed."),
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
    "Return APIWeave MCP server name, version, transport, and the URIs of the authoring guides. Read `apiweave://guide/start-here` before building a workflow — it covers the node/edge conventions and path syntax that the tool schemas alone do not.",
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
