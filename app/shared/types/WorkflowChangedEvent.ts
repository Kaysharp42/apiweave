import type { Workflow } from "./Workflow"

/**
 * One workflow write broadcast to whoever has the workflow open.
 *
 * `upsert` carries the authoritative post-write snapshot; `delete` names a row
 * that no longer exists, so there is nothing to carry — only enough for the
 * renderer to recognize the workflow it is showing and let go of it.
 */
export type WorkflowChangedEvent =
  | { readonly kind: "upsert"; readonly workflow: Workflow }
  | { readonly kind: "delete"; readonly workspaceId: string; readonly workflowId: string }
