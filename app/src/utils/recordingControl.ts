import type { CanvasToolbarRecordProps } from "../types/CanvasToolbarRecordProps";
import type { RecordingPhase } from "../types/RecordingPhase";

/**
 * This canvas's view of the app-wide recording: what the Record control shows,
 * minus the actions that open or stop one. A recording in another workflow
 * reads as `elsewhere` rather than as its phase, and its steps are not this
 * one's to count: a click in another canvas is not a step here.
 */
export function recordingControlView(
  phase: RecordingPhase,
  isThisWorkflow: boolean,
  stopping: boolean,
  stepCount: number,
): Omit<CanvasToolbarRecordProps, "disabled" | "onRecord" | "onStop" | "showLabel"> {
  return {
    state: phase !== "idle" && !isThisWorkflow ? "elsewhere" : phase,
    stopping: isThisWorkflow && stopping,
    stepCount: isThisWorkflow ? stepCount : 0,
  };
}

/** Nothing to record into yet: a run is in progress, or the canvas or its workflow is not ready. */
export function isRecordControlDisabled(
  isRunning: boolean,
  isHydrated: boolean,
  workflowId: string | undefined,
  workspaceId: string | undefined,
): boolean {
  return isRunning || !isHydrated || workflowId === undefined || workspaceId === undefined;
}
