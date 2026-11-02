/** Calls and response bytes for one scripted task, measured through a real MCP client. */
export interface McpScriptedTaskResult {
  readonly taskId: string
  /** Tool invocations plus resource reads — every MCP request the task made. */
  readonly callCount: number
  readonly toolCallCount: number
  readonly resourceReadCount: number
  readonly responseWireJsonBytes: number
  readonly responseTextBytes: number
  readonly toolNames: readonly string[]
  readonly taskSuccess: boolean
}
