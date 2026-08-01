/**
 * Canvas-facing execution state for a node.
 *
 * `skipped` is a real state with its own affordance, never a check with a
 * caveat. The runner already emits it (`RunnerNodeStatusSchema`) and
 * `canvasStatus()` passes it through unchanged; `BaseNode` renders it.
 */
export type NodeStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "skipped";
