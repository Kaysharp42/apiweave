import { Circle, Loader2, Square } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { CanvasToolbarRecordProps } from "../../types";

const QUIET = "h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark";
const ICON = "w-4 h-4 shrink-0";
const SPINNER = <Loader2 className={`${ICON} animate-spin motion-reduce:animate-none`} />;

/** Replaying the steps before a re-pick or re-record, or waiting for the user's pick: nothing recorded yet. */
const isWaiting = (state: CanvasToolbarRecordProps["state"]): boolean => state === "replaying" || state === "picking";

/** Stop pressed on a replay or a pick cancels it rather than ending a recording. */
const isCancelling = ({ state, stopping }: CanvasToolbarRecordProps): boolean => stopping && state !== "recording";

/** What the badge says: the live step count while recording, else what the user is waiting on or doing. */
function statusText({ state, stepCount, showLabel, stopping }: CanvasToolbarRecordProps): string {
  // Stop on a replay or a pick cancels it rather than ending a recording, and nothing was recorded to count.
  if (stopping && state !== "recording") return "Cancelling…";
  if (state === "replaying") return showLabel ? "Replaying the steps before…" : "Replaying…";
  if (state === "picking") return showLabel ? "Click the element in the browser" : "Picking…";
  const steps = stepCount === 1 ? "1 step" : `${stepCount} steps`;
  return showLabel ? `Recording — ${steps}` : steps;
}

/** Replay and pick say something is in progress; so does a stop that cancels one. */
const badgeVariant = (props: CanvasToolbarRecordProps): "info" | "error" =>
  isWaiting(props.state) || isCancelling(props) ? "info" : "error";

/** The badge's icon: a spinner while replaying or cancelling, else the pulsing dot of a live recording. */
const badgeIcon = (props: CanvasToolbarRecordProps) =>
  props.state === "replaying" || isCancelling(props) ? (
    <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
  ) : (
    <span className="h-2 w-2 rounded-full bg-current animate-pulse motion-reduce:animate-none" aria-hidden="true" />
  );

/** Stop's icon: a spinner once it has been pressed, else the square that ends a recording. */
const stopIcon = (stopping: boolean) => (stopping ? SPINNER : <Square className={ICON} />);

/** Stop cancels a replay or a pick, and ends a recording. */
const stopAriaLabel = (state: CanvasToolbarRecordProps["state"]): string => (isWaiting(state) ? "Cancel" : "Stop recording");

/** What Stop's visible label says it does right now. */
function stopLabel({ state, stopping }: CanvasToolbarRecordProps): string {
  if (stopping) return state === "recording" ? "Stopping…" : "Cancelling…";
  return isWaiting(state) ? "Cancel" : "Stop";
}

/**
 * While this workflow is being recorded, re-recorded or re-picked: where it
 * stands, and Stop. Before anything is recorded — the replay, the pick — Stop
 * reads Cancel, because it changes nothing on the canvas, and says Cancelling
 * while it waits for the browser to close.
 */
function RecordingStatus(props: CanvasToolbarRecordProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Badge variant={badgeVariant(props)} size="sm" className="shrink-0 gap-1.5" aria-live="polite">
        {badgeIcon(props)}
        {statusText(props)}
      </Badge>
      <Button
        variant="ghost"
        intent="error"
        size="sm"
        onClick={props.onStop}
        disabled={props.stopping}
        className="h-8 whitespace-nowrap"
        aria-label={stopAriaLabel(props.state)}
        icon={stopIcon(props.stopping)}
      >
        {props.showLabel && <span>{stopLabel(props)}</span>}
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
  const live = props.state !== "idle" && props.state !== "starting" && props.state !== "elsewhere";
  const shown = { ...props, showLabel: props.showLabel ?? true };
  return live ? <RecordingStatus {...shown} /> : <RecordButton {...shown} />;
}
