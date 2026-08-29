/**
 * One run beginning, announced on the unkeyed `apiweave:run-started` channel.
 *
 * The workflow identity is resolved in the main process rather than added to
 * `RunEvent`: the broker's events are also the MCP resource-subscription
 * payload, and a run's workspace/workflow is not news to a subscriber that
 * asked for that run by URI.
 */
export interface RunStartedEvent {
  readonly runId: string
  readonly workspaceId: string
  readonly workflowId: string
}
