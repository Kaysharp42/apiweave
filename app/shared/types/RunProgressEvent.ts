import type { RunnerNodeStatus } from "./RunnerNodeStatus"

/** The four terminal run statuses a `run.finished` event can carry. */
export type RunTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted"

/**
 * A raw run transition as emitted by the scheduler/executor — before the
 * {@link RunEventBroker} stamps it with a monotonic sequence and timestamp
 * (Phase 6). Three honest kinds replace the old single `node.completed` (which
 * was emitted even for a `running` transition):
 *
 * - `run.started` — the run left the queue and began executing.
 * - `node.status` — one node status transition (pending → running →
 *   passed/failed). Carries the current variable snapshot and a tiny failure
 *   summary when a node fails. Full request/response bodies stay out.
 * - `run.finished` — the terminal event: the run reached a terminal status.
 */
export type RunEvent =
  | {
      readonly kind: "run.started"
      readonly runId: string
    }
  | {
      readonly kind: "node.status"
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
      readonly status: RunTerminalStatus
    }

/**
 * A broker-stamped run event delivered to subscribers (the renderer over the
 * per-run IPC topic, and MCP resource-subscription notifications). `seq` is a
 * monotonic per-run counter and `ts` is an ISO timestamp, so a client can tell
 * whether a re-read reflects a newer state. Intersection distributes over the
 * union, so each member keeps its `kind` discriminant plus `seq`/`ts`.
 */
export type RunProgressEvent = RunEvent & { readonly seq: number; readonly ts: string }
