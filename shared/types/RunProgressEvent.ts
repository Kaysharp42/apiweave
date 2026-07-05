import type { RunnerNodeStatus } from "./RunnerNodeStatus"

/**
 * Streamed to the renderer over the per-run IPC progress topic as the executor
 * advances (decision #6, (c)). The `kind` discriminant is the extension seam:
 * Task 15 adds `run.completed`/`run.failed` variants alongside `node.completed`.
 */
export type RunProgressEvent = {
  readonly kind: "node.completed"
  readonly runId: string
  readonly nodeId: string
  readonly status: RunnerNodeStatus
  readonly variables: Readonly<Record<string, unknown>>
}
