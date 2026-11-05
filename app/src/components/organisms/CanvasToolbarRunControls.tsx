import { Badge } from "../atoms/Badge";
import { CanvasToolbarRunButton } from "./CanvasToolbarRunButton";
import { CanvasToolbarRunMenu } from "./CanvasToolbarRunMenu";
import { CanvasToolbarRunWithData } from "./CanvasToolbarRunWithData";
import type { CanvasToolbarRunControlsProps } from "../../types";

/** The run controls: iteration, the data-file picker, Run/Cancel, and Run options. */
export function CanvasToolbarRunControls({
  onRun,
  onRunWithData,
  onCancel,
  onRerunFailed,
  onRunFromFailedNode,
  isRunning,
  iteration,
  resumeOptions,
  isResumeLoading,
}: CanvasToolbarRunControlsProps) {
  return (
    <>
      {isRunning && iteration !== null && (
        <Badge
          variant="info"
          size="sm"
          className="shrink-0"
          aria-live="polite"
        >
          Iteration {iteration.index}/{iteration.count}
        </Badge>
      )}

      {onRunWithData && (
        <CanvasToolbarRunWithData
          onRunWithData={onRunWithData}
          isRunning={isRunning}
        />
      )}

      <div className="flex shrink-0">
        <CanvasToolbarRunButton
          onRun={onRun}
          onCancel={onCancel}
          isRunning={isRunning}
        />

        <CanvasToolbarRunMenu
          isRunning={isRunning}
          resumeOptions={resumeOptions}
          isResumeLoading={isResumeLoading}
          onRerunFailed={onRerunFailed}
          onRunFromFailedNode={onRunFromFailedNode}
        />
      </div>
    </>
  );
}
