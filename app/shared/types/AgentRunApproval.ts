/**
 * A "Never ask again" answer from the agent-run approval dialog. Matching is
 * exact: the same agent, workflow, secret names, destinations and script
 * presence skips the question; any of those changing asks again.
 */
export interface AgentRunApproval {
  readonly approvalId: string
  readonly workspaceId: string
  readonly agent: string
  readonly workflowId: string
  readonly workflowName: string
  readonly secretNames: readonly string[]
  readonly destinations: readonly string[]
  readonly runsScripts: boolean
  readonly createdAt: string
}
