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
 *  - `secrets.set`, `secrets.delete` — keystore mutations; MCP secret surface is
 *    read-only metadata (`list`, `resolve`), matching the Python "metadata-only" posture.
 *  - `runs.getArtifacts`, `runs.openArtifact`, `runs.saveArtifactAs` — Electron
 *    shell/dialog operations, not agent tools.
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
  /** Apply the metadata-only run projection after the shared IPC response sanitizer. */
  readonly resultProjection?: "run"
  /**
   * Run `workflows.diagnose` on the written workflow and return the report
   * alongside the result. Set on every tool that writes a graph: a graph with a
   * missing edge handle or an unaddressable assertion path saves cleanly and
   * only misbehaves at run time, so without this the cheapest way for an agent
   * to discover the mistake is to fire real HTTP requests at someone's API.
   */
  readonly diagnoseAfterWrite?: boolean
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

  // Workflows
  tool("workflows", "list", "read", "List workflows in a workspace."),
  tool("workflows", "get", "read", "Get a workflow's full graph. Credential values are withheld (`<SECRET>`) but the structure is intact; `{{secrets.NAME}}` references come back verbatim. Reading an existing workflow is the fastest way to learn this workspace's conventions before authoring a new one."),
  tool("workflows", "diagnose", "read", "Statically check a stored workflow — topology, assertion paths and edge handles, variable provenance — and, with a `runId`, correlate a past run's failures. Side-effect-free and sends no HTTP: use it to find graph mistakes instead of discovering them with a live run. Read `apiweave://guide/diagnostics` for what each code means.", { name: "workflow_diagnose" }),
  tool("assertions", "suggest", "read", "Propose verified assertion rules from one stored HTTP result — the reliable way to get paths right, since the rules are derived from a response that actually happened. Requires a completed run of that node; before one exists, author rules from the schema and check them with assertion_validate.", { name: "assertion_suggest" }),
  tool("assertions", "validate", "read", "Check assertion rules and return a human-readable preview plus per-rule issues, without changing the workflow. Canonicalizes what it accepts (a `prev` path gains its `response.` prefix), so the returned `rules` are what assertion_apply should receive.", { name: "assertion_validate" }),
  tool("assertions", "apply", "write", "Apply validated rules to one assertion node when the workflow revision still matches. Pass `expectedRevision` from the workflow's current `rev`.", { name: "assertion_apply" }),
  tool("workflows", "create", "write", "Create a workflow from nodes, edges and variables, and return it with a `diagnosis` report — check that report before running anything. A `workflow` node runs another workflow in the same workspace as one step. Read `apiweave://guide/workflow-authoring` first if you have not built a graph here before.", { diagnoseAfterWrite: true }),
  tool("workflows", "update", "write", "Replace a workflow's graph, variables or metadata, and return it with a `diagnosis` report. `nodes` and `edges` are REPLACED wholesale, so send the complete lists; use workflows_patch to change a subset.", { idempotent: true, diagnoseAfterWrite: true }),
  tool("workflows", "patch", "write", "Change part of a workflow without resending the whole graph: upsert or remove nodes and edges by id, and merge workflow variables. Returns the updated workflow with a `diagnosis` report. Pass `expectedRevision` to make it a compare-and-swap against the revision you last read.", { idempotent: true, diagnoseAfterWrite: true }),
  tool("workflows", "delete", "write", "Delete a workflow.", { destructive: true, idempotent: true }),
  tool("workflows", "attachToCollection", "write", "Attach or detach a workflow to a collection.", { idempotent: true }),
  tool("workflows", "setEnvironment", "write", "Set or clear the selected environment for a workflow.", { idempotent: true }),

  // Projects
  tool("projects", "list", "read", "List projects in a workspace."),
  tool("projects", "get", "read", "Get a project by id."),
  tool("projects", "create", "write", "Create a project."),
  tool("projects", "update", "write", "Update a project.", { idempotent: true }),
  tool("projects", "delete", "write", "Delete an empty project.", { destructive: true, idempotent: true }),
  tool("projects", "addWorkflow", "write", "Add a workflow to a project."),
  tool("projects", "removeWorkflow", "write", "Remove a workflow from a project.", { destructive: true, idempotent: true }),
  tool("projects", "listWorkflows", "read", "List workflows in a project."),

  // Environments
  tool("environments", "list", "read", "List environments in a workspace."),
  tool("environments", "get", "read", "Get an environment by id."),
  tool("environments", "create", "write", "Create an environment. Set `baseEnvironmentId` to inherit plain variables from another environment in the same workspace."),
  tool("environments", "update", "write", "Update an environment, including its `baseEnvironmentId` (null clears inheritance).", { idempotent: true }),
  tool("environments", "delete", "write", "Delete an environment.", { destructive: true, idempotent: true }),
  tool("environments", "setVariable", "write", "Set a variable on an environment.", { idempotent: true }),
  tool("environments", "deleteVariable", "write", "Delete a variable from an environment.", { destructive: true, idempotent: true }),

  // Node presets — the workspace's reusable node configurations. Reads come back
  // through the same blanket redaction every other MCP read gets, so a preset
  // built from a real request reports `<SECRET>` for its body, URL and headers:
  // an agent can catalogue and author presets, but cannot re-emit a redacted one
  // into a workflow. Dragging a preset onto a canvas stays a desktop action.
  tool("nodePresets", "list", "read", "List a workspace's saved node presets (reusable node configurations). Config values are redacted like any other MCP read."),
  tool("nodePresets", "create", "write", "Save a reusable node preset in a workspace from a name, node type and config."),
  tool("nodePresets", "update", "write", "Update a saved node preset's name, node type or config.", { idempotent: true }),
  tool("nodePresets", "delete", "write", "Delete a saved node preset.", { destructive: true, idempotent: true }),

// Runs
  tool("runs", "create", "write", "Trigger a workflow run and return a metadata-only run snapshot.", { openWorld: true, resultProjection: "run" }),
  tool("runs", "get", "read", "Get a metadata-only run snapshot with per-node status.", { resultProjection: "run" }),
  tool("runs", "getNodeResult", "read", "Get the full stored request/response for one node of a run, body included, plus extractorOutcomes, assertions and unresolvedPlaceholders. Use this when runs_get shows a failed node and the status code alone is not enough — the body is usually where the target service explains the failure (e.g. LEGAL_CATEGORY_NOT_FOUND), and unresolvedPlaceholders names any {{env.*}}/{{variables.*}} references that went out as literal text (a 401 with placeholders present is a missing value, not bad credentials). The same secret-redaction pass every other MCP read applies runs over the body, headers, URL and request — secrets never leave the keystore.", { name: "runs_getNodeResult" }),
  tool("runs", "listByWorkflow", "read", "List metadata-only run snapshots for a workflow.", { resultProjection: "run" }),
  tool("runs", "listByWorkspace", "read", "List metadata-only run snapshots across a workspace.", { resultProjection: "run" }),
  tool("runs", "getLatest", "read", "Get the most recent metadata-only run snapshot for a workflow.", { resultProjection: "run" }),
  tool("runs", "getLatestFailed", "read", "Get the most recent failed metadata-only run snapshot for a workflow.", { resultProjection: "run" }),
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
