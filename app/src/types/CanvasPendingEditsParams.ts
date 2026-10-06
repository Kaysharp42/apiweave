import type { CanvasWorkflowState } from "./CanvasWorkflowState";

/** What `useCanvasPendingEdits` needs from the mounted canvas. */
export interface CanvasPendingEditsParams {
  workflowId: string | undefined;
  isHydrated: boolean;
  /** Sends a pending auto-save now (useAutoSave's flush). */
  flush: () => Promise<void>;
  /** The explicit save, as the Save button and Ctrl+S make. */
  save: () => Promise<void>;
  /** The live graph and variables, read when they are needed. */
  readCanvas: () => Omit<CanvasWorkflowState, "selectedEnvironmentId">;
}
