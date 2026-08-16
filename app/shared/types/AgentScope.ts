/**
 * What a local working directory, or an agent session, is attached to.
 *
 * `project` is a collection row, `workflow` a workflow row. Two kinds rather
 * than one because of monorepos: the project maps to the repository, and an
 * individual workflow may map to a sub-package inside it.
 */
export type AgentScopeKind = "project" | "workflow"

export const AGENT_SCOPE_KINDS: readonly AgentScopeKind[] = ["project", "workflow"]

export interface AgentScope {
  readonly kind: AgentScopeKind
  readonly id: string
}

export function isAgentScopeKind(value: unknown): value is AgentScopeKind {
  return typeof value === "string" && (AGENT_SCOPE_KINDS as readonly string[]).includes(value)
}
