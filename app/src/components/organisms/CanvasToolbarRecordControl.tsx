import { Circle, Loader2, Square } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { CanvasToolbarRecordProps } from "../../types";

const QUIET = "h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark";
const ICON = "w-4 h-4 shrink-0";
const SPINNER = <Loader2 className={`${ICON} animate-spin motion-reduce:animate-none`} />;

/** While this workflow is being recorded: the live step count, and Stop. */
function RecordingStatus({ state, stepCount, onStop, showLabel }: CanvasToolbarRecordProps) {
  const steps = stepCount === 1 ? "1 step" : `${stepCount} steps`;
  const stopping = state === "stopping";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Badge variant="error" size="sm" className="shrink-0 gap-1.5" aria-live="polite">
        <span className="h-2 w-2 rounded-full bg-current animate-pulse motion-reduce:animate-none" aria-hidden="true" />
        {showLabel ? `Recording — ${steps}` : steps}
      </Badge>
      <Button
        variant="ghost"
        intent="error"
        size="sm"
        onClick={onStop}
        disabled={stopping}
        className="h-8 whitespace-nowrap"
        aria-label="Stop recording"
        icon={stopping ? SPINNER : <Square className={ICON} />}
      >
        {showLabel && <span>{stopping ? "Stopping…" : "Stop"}</span>}
      </Button>
    </div>
  );
}

function recordTooltip(state: CanvasToolbarRecordProps["state"], disabled: boolean): string {
  if (state === "elsewhere") return "Another workflow is being recorded. Stop that recording first.";
  if (disabled) return "Recording is available once the workflow has loaded and no run is in progress.";
  return "Record steps by clicking through a page in a browser";
}

/** Record: opens the start dialog. Disabled while the browser opens, a run is in progress, or another workflow records. */
function RecordButton({ state, disabled, onRecord, showLabel }: CanvasToolbarRecordProps) {
  const starting = state === "starting";
  return (
    <Tooltip content={recordTooltip(state, disabled)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRecord}
        disabled={disabled || starting || state === "elsewhere"}
        className={QUIET}
        aria-label="Record browser steps"
        icon={starting ? SPINNER : <Circle className={`${ICON} fill-current text-(--aw-status-error)`} />}
      >
        {showLabel && <span>{starting ? "Opening browser…" : "Record"}</span>}
      </Button>
    </Tooltip>
  );
}

/**
 * Record browser steps: a button while nothing records, then the live count
 * and Stop while this workflow is being recorded.
 */
export function CanvasToolbarRecordControl(props: CanvasToolbarRecordProps) {
  const live = props.state === "recording" || props.state === "stopping";
  const shown = { ...props, showLabel: props.showLabel ?? true };
  return live ? <RecordingStatus {...shown} /> : <RecordButton {...shown} />;
}
