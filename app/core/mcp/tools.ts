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
  tool("workflows", "get", "read", "Get a workflow's full graph (secret values redacted to references)."),
  tool("workflows", "diagnose", "read", "Diagnose workflow graph and optional stored-run failures without exposing response or secret values.", { name: "workflow_diagnose" }),
  tool("assertions", "suggest", "read", "Suggest deterministic assertions from one stored HTTP result without changing the workflow.", { name: "assertion_suggest" }),
  tool("assertions", "validate", "read", "Validate and preview canonical assertion rules without changing the workflow.", { name: "assertion_validate" }),
  tool("assertions", "apply", "write", "Apply validated rules to one assertion node when the workflow revision still matches.", { name: "assertion_apply" }),
  tool("workflows", "create", "write", "Create a workflow from nodes, edges and variables."),
  tool("workflows", "update", "write", "Update a workflow's graph, variables or metadata.", { idempotent: true }),
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
  tool("environments", "create", "write", "Create an environment."),
  tool("environments", "update", "write", "Update an environment.", { idempotent: true }),
  tool("environments", "delete", "write", "Delete an environment.", { destructive: true, idempotent: true }),
  tool("environments", "setVariable", "write", "Set a variable on an environment.", { idempotent: true }),
  tool("environments", "deleteVariable", "write", "Delete a variable from an environment.", { destructive: true, idempotent: true }),

  // Runs
  tool("runs", "create", "write", "Trigger a workflow run and return a metadata-only run snapshot.", { openWorld: true, resultProjection: "run" }),
  tool("runs", "get", "read", "Get a metadata-only run snapshot with per-node status.", { resultProjection: "run" }),
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
  description: "Return APIWeave MCP server name, version and transport.",
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
