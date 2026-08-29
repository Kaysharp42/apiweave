/**
 * One successful MCP write, announced on the unkeyed `apiweave:agent-write`
 * channel so the renderer can refetch what the agent changed.
 *
 * Coarse on purpose — the domain and action, not a snapshot of the row. The
 * renderer's stores refetch lists rather than patch them (there is no query
 * cache to invalidate), so a row here would be data it throws away. See
 * `AGENT_WRITE_CHANNEL`.
 */
export interface AgentWriteEvent {
  /** The IPC domain written, e.g. `"environments"`. */
  readonly domain: string
  /** The action, e.g. `"setVariable"`. */
  readonly action: string
  /**
   * The workspace the call named, when it named one. Only used to notice that
   * the workspace the user is *in* has been deleted — refetches ignore it, so a
   * cross-workspace move (which names one side only) still refreshes both.
   */
  readonly workspaceId?: string
}
