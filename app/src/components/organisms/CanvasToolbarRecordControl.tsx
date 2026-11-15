import { Circle, Loader2, Square } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { CanvasToolbarRecordProps } from "../../types";

const QUIET = "h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark";

/**
 * Record browser steps: a button while nothing records, then the live count
 * and Stop while this workflow is being recorded.
 */
export function CanvasToolbarRecordControl({ state, stepCount, disabled, onRecord, onStop, showLabel = true }: CanvasToolbarRecordProps) {
  if (state === "recording" || state === "stopping") {
    const steps = stepCount === 1 ? "1 step" : `${stepCount} steps`;
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
          disabled={state === "stopping"}
          className="h-8 whitespace-nowrap"
          aria-label="Stop recording"
          icon={
            state === "stopping" ? (
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Square className="w-4 h-4" />
            )
          }
        >
          {showLabel && <span>{state === "stopping" ? "Stopping…" : "Stop"}</span>}
        </Button>
      </div>
    );
  }

  const starting = state === "starting";
  const tooltip =
    state === "elsewhere"
      ? "Another workflow is being recorded. Stop that recording first."
      : disabled
        ? "Recording is available once the workflow has loaded and no run is in progress."
        : "Record steps by clicking through a page in a browser";
  return (
    <Tooltip content={tooltip}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRecord}
        disabled={disabled || starting || state === "elsewhere"}
        className={QUIET}
        aria-label="Record browser steps"
        icon={
          starting ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : (
            <Circle className="w-4 h-4 shrink-0 fill-current text-(--aw-status-error)" />
          )
        }
      >
        {showLabel && <span>{starting ? "Opening browser…" : "Record"}</span>}
      </Button>
    </Tooltip>
  );
}
