import type { RunnerNodeStatus } from "./RunnerNodeStatus"

/**
 * Streamed to the renderer over the per-run IPC progress topic as a run
 * advances (decision #6, (c)). The `kind` discriminant is the extension seam.
 *
 * - `node.completed` — one per node status transition (running → passed/failed).
 *   Carries status, the current variable snapshot, and a tiny failure summary
 *   when a node fails. Full request/response bodies stay out of the stream.
 * - `run.finished` — the terminal event: the run reached a terminal status.
 *   Lets the renderer stop the subscription without polling for final status.
 */
export type RunProgressEvent =
  | {
      readonly kind: "node.completed"
      readonly runId: string
      readonly nodeId: string
      readonly status: RunnerNodeStatus
      readonly variables: Readonly<Record<string, unknown>>
      readonly error?: string
      readonly message?: string
      readonly statusCode?: number
    }
  | {
      readonly kind: "run.finished"
      readonly runId: string
      readonly status: "completed" | "failed" | "cancelled" | "interrupted"
    }
