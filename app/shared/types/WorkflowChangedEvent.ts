import type { Workflow } from "./Workflow"

/**
 * One workflow write broadcast to whoever has the workflow open.
 *
 * `upsert` carries the authoritative post-write snapshot; `delete` names a row
 * that no longer exists, so there is nothing to carry — only enough for the
 * renderer to recognize the workflow it is showing and let go of it.
 * `movedFrom` names the workspace an upsert took the workflow out of, on the
 * one write that moves it: that workspace changed too.
 */
export type WorkflowChangedEvent =
  | { readonly kind: "upsert"; readonly workflow: Workflow; readonly movedFrom?: string }
  | { readonly kind: "delete"; readonly workspaceId: string; readonly workflowId: string }
