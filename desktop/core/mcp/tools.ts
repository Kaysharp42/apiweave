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
  /** One-line description surfaced to the LLM via `tools/list` — the one thing the IPC registry lacks. */
  readonly description: string
}

export const MCP_TOOLS: readonly McpToolSpec[] = [
  // Workspaces
  { domain: "workspaces", action: "list", description: "List all workspaces." },
  { domain: "workspaces", action: "get", description: "Get a workspace by id." },
  { domain: "workspaces", action: "create", description: "Create a workspace." },
  { domain: "workspaces", action: "update", description: "Update a workspace's name or settings." },
  { domain: "workspaces", action: "delete", description: "Delete a workspace and its contents." },

  // Workflows
  { domain: "workflows", action: "list", description: "List workflows in a workspace." },
  { domain: "workflows", action: "get", description: "Get a workflow's full graph (secret values redacted to references)." },
  { domain: "workflows", action: "create", description: "Create a workflow from nodes, edges and variables." },
  { domain: "workflows", action: "update", description: "Update a workflow's graph, variables or metadata." },
  { domain: "workflows", action: "delete", description: "Delete a workflow." },
  { domain: "workflows", action: "attachToCollection", description: "Attach or detach a workflow to a collection." },
  { domain: "workflows", action: "setEnvironment", description: "Set or clear the selected environment for a workflow." },

  // Collections (projects)
  { domain: "collections", action: "list", description: "List collections in a workspace." },
  { domain: "collections", action: "get", description: "Get a collection by id." },
  { domain: "collections", action: "create", description: "Create a collection." },
  { domain: "collections", action: "update", description: "Update a collection." },
  { domain: "collections", action: "delete", description: "Delete an empty collection." },
  { domain: "collections", action: "addWorkflow", description: "Add a workflow to a collection." },
  { domain: "collections", action: "removeWorkflow", description: "Remove a workflow from a collection." },
  { domain: "collections", action: "listWorkflows", description: "List workflows in a collection." },

  // Environments
  { domain: "environments", action: "list", description: "List environments in a workspace." },
  { domain: "environments", action: "get", description: "Get an environment by id." },
  { domain: "environments", action: "create", description: "Create an environment." },
  { domain: "environments", action: "update", description: "Update an environment." },
  { domain: "environments", action: "delete", description: "Delete an environment." },
  { domain: "environments", action: "setVariable", description: "Set a variable on an environment." },
  { domain: "environments", action: "deleteVariable", description: "Delete a variable from an environment." },

  // Runs
  { domain: "runs", action: "create", description: "Trigger a workflow run." },
  { domain: "runs", action: "get", description: "Get a run by id, including per-node status." },
  { domain: "runs", action: "listByWorkflow", description: "List runs for a workflow." },
  { domain: "runs", action: "listByWorkspace", description: "List runs across a workspace." },
  { domain: "runs", action: "getLatest", description: "Get the most recent run for a workflow." },
  { domain: "runs", action: "getLatestFailed", description: "Get the most recent failed run for a workflow." },
  { domain: "runs", action: "cancel", description: "Cancel a queued or running run." },

  // Secrets — read-only metadata surface (never plaintext, never sealed bytes)
  { domain: "secrets", action: "list", description: "List secret metadata (names/scopes) for a scope. Never returns secret values." },
  { domain: "secrets", action: "resolve", description: "Resolve which scope a secret name binds to. Returns metadata only, never the value." },

  // Projects — export/import (references only, fail-closed on plaintext)
  { domain: "projects", action: "export", description: "Export a collection bundle (secret references only, no values)." },
  { domain: "projects", action: "dryRun", description: "Preview importing a bundle without writing." },
  { domain: "projects", action: "import", description: "Import a collection bundle into a workspace." },
]

/** The MCP tool name for a spec: `${domain}_${action}` (camelCase surface, mirrors the IPC contract). */
export function toolName(spec: McpToolSpec): string {
  return `${spec.domain}_${spec.action}`
}
