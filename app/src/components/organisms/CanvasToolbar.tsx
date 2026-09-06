import { useRef, useState } from "react";
import {
  Save,
  History,
  Play,
  Square,
  Code,
  Upload,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ChevronDown,
  Lock,
  LockOpen,
  Undo2,
  Redo2,
  Command,
  Frame,
  Ungroup,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import ButtonSelect from "../ButtonSelect";
import { AgentLaunchButton } from "./AgentLaunchButton";
import { useOpenAgentSession } from "../../hooks/useAgentDockControls";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
import { useElementWidth } from "../../hooks/useElementWidth";
import useCanvasPrefsStore from "../../stores/CanvasPrefsStore";
import type { CanvasToolbarProps } from "../../types/CanvasToolbarProps";
import type { ToolbarButtonProps } from "../../types/ToolbarButtonProps";
import { buildEnvironmentOptions, resolveToolbarDensity } from "./canvasToolbarUtils";

const EMPTY_ENVIRONMENTS: Array<{ environmentId: string; name: string }> = [];
const EMPTY_RESUME_OPTIONS: NonNullable<CanvasToolbarProps["resumeOptions"]> =
  [];

// ponytail: resume (run-from-failed) UI is hidden — executeWorkflow ignores the
// resume payload and always triggers a FULL run, so these controls would re-run
// destructive/expensive API calls while telling the user otherwise. Flip to true
// once the scheduler resume path is wired (deferred Task 13/21). See the matching
// note in app/src/hooks/useWorkflowPolling.ts (executeWorkflow).
const RESUME_ENABLED = false;

export function CanvasToolbar({
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onGroup,
  onUngroup,
  canGroup,
  canUngroup,
  onHistory,
  onJsonEditor,
  onImport,
  onCommandPalette,
  onRun,
  onCancel,
  onRunFromLastFailed,
  onRunAllFailed,
  onRunFromFailedNode,
  isRunning = false,
  environments = EMPTY_ENVIRONMENTS,
  selectedEnvironment,
  onEnvironmentChange,
  onRefreshSwagger,
  isSwaggerRefreshing = false,
  workflowId,
  resumeOptions = EMPTY_RESUME_OPTIONS,
  isResumeLoading = false,
}: CanvasToolbarProps) {
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const openAgentSession = useOpenAgentSession();
  // Straight from the store rather than down a prop chain: the lock is one
  // boolean the canvas reads from the same place, and threading it through
  // `CanvasToolbarProps` would only give it a second name.
  const canvasLocked = useCanvasPrefsStore((s) => s.locked);
  const setCanvasPrefs = useCanvasPrefsStore((s) => s.setCanvasPrefs);
  const safeResumeOptions = resumeOptions ?? EMPTY_RESUME_OPTIONS;

  const hasResumeOptions = safeResumeOptions.length > 0;

  // Measured on the track, not the bar: the bar is content-sized, so asking it
  // how wide it is only ever answers "as wide as I want to be".
  const [trackRef, availableWidth] = useElementWidth<HTMLDivElement>();
  const density = resolveToolbarDensity(availableWidth);
  const showLabels = density === "labels";
  const useOverflow = density === "overflow";

  useCloseOnOutsideOrEscape(isRunMenuOpen, () => setIsRunMenuOpen(false), runMenuRef);
  useCloseOnOutsideOrEscape(
    isOverflowOpen,
    () => setIsOverflowOpen(false),
    overflowRef,
  );

  return (
    // Two elements, because this bar has to know how much room it was given.
    // The track spans the canvas and is what gets measured; the bar centres
    // inside it and never wraps.
    //
    // It used to be one absolutely positioned, centred, `flex-wrap` div, and
    // both halves of that were wrong. Wrapping put a second row over the
    // canvas, which silently invalidates `CanvasToolbarBand` — the run camera
    // reads that constant to avoid framing a node underneath this bar.
    // Reaching for `lg:` to collapse the labels asked the *viewport* how wide
    // it was, so opening the agent panel narrowed the canvas without ever
    // tripping the breakpoint: full labels, half the room, second row.
    //
    // `pointer-events-none` on the track so the canvas underneath it stays
    // draggable; the bar puts them back for itself.
    <div
      ref={trackRef}
      className="absolute top-3 inset-x-3 z-20 pointer-events-none flex justify-center"
    >
      <div
        className="pointer-events-auto flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 px-2 py-1.5 rounded-sm bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark shadow-node"
        role="toolbar"
        aria-label="Workflow actions"
      >
        <div className="flex flex-shrink-0 items-center">
          <ToolbarButton
            icon={Save}
            label="Save"
            onClick={onSave}
            tooltip="Save workflow (Ctrl+S)"
            showLabel={showLabels}
          />
          <IconButton
            onClick={onCommandPalette}
            tooltip="Command palette (Ctrl+K)"
            aria-label="Open command palette"
            variant="ghost"
            size="sm"
          >
            <Command className="w-4 h-4" />
          </IconButton>
          {/* Icon-only at every density, like the camera lock: undo is a
              reflex, and a reflex two clicks deep in an overflow menu is not
              one. The disabled state is the only affordance telling you
              whether there is anything left to undo. */}
          <IconButton
            onClick={onUndo}
            disabled={!canUndo}
            tooltip="Undo (Ctrl+Z)"
            aria-label="Undo"
            variant="ghost"
            size="sm"
          >
            <Undo2 className="w-4 h-4" />
          </IconButton>
          <IconButton
            onClick={onRedo}
            disabled={!canRedo}
            tooltip="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            variant="ghost"
            size="sm"
          >
            <Redo2 className="w-4 h-4" />
          </IconButton>
          <IconButton
            onClick={onGroup}
            disabled={!canGroup}
            tooltip={
              canGroup
                ? "Frame selection (Ctrl+G)"
                : "Select two ungrouped nodes to frame"
            }
            aria-label="Frame selection"
            variant="ghost"
            size="sm"
          >
            <Frame className="w-4 h-4" />
          </IconButton>
          <IconButton
            onClick={onUngroup}
            disabled={!canUngroup}
            tooltip={
              canUngroup
                ? "Ungroup selection (Ctrl+Shift+G)"
                : "Select a frame or framed node to ungroup"
            }
            aria-label="Ungroup selection"
            variant="ghost"
            size="sm"
          >
            <Ungroup className="w-4 h-4" />
          </IconButton>
          {!useOverflow && (
            <ToolbarButton
              icon={History}
              label="History"
              onClick={onHistory}
              tooltip="Run history"
              showLabel={showLabels}
            />
          )}
          <ToolbarButton
            icon={Code}
            label="JSON"
            onClick={onJsonEditor}
            tooltip="JSON editor (Ctrl+J)"
            showLabel={showLabels}
          />
          {!useOverflow && (
            <ToolbarButton
              icon={Upload}
              label="Import"
              onClick={onImport}
              tooltip="Import nodes"
              showLabel={showLabels}
            />
          )}
          {/* Icon-only at every density, and never in the overflow menu: this
              is reached mid-drag, when the map has just slid out from under
              someone, and a lock two clicks deep does not get used. */}
          <IconButton
            onClick={() => setCanvasPrefs({ locked: !canvasLocked })}
            tooltip={canvasLocked ? "Unlock camera" : "Lock camera"}
            aria-pressed={canvasLocked}
            aria-label={canvasLocked ? "Unlock camera" : "Lock camera"}
            variant={canvasLocked ? "primary" : "ghost"}
            size="sm"
          >
            {canvasLocked ? (
              <Lock className="w-4 h-4" />
            ) : (
              <LockOpen className="w-4 h-4" />
            )}
          </IconButton>
        </div>

        {useOverflow && (
          <div className="relative flex flex-shrink-0" ref={overflowRef}>
            <IconButton
              onClick={() => setIsOverflowOpen((open) => !open)}
              tooltip="More actions"
              aria-haspopup="menu"
              aria-expanded={isOverflowOpen}
              variant="ghost"
              size="sm"
            >
              <MoreHorizontal className="w-4 h-4" />
            </IconButton>

            {isOverflowOpen && (
              <div
                role="menu"
                aria-label="More actions"
                className="absolute top-9 left-0 z-50 min-w-[180px] overflow-hidden rounded-sm border border-border bg-surface-raised shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
              >
                <OverflowItem
                  icon={History}
                  label="Run history"
                  onSelect={() => {
                    setIsOverflowOpen(false);
                    onHistory();
                  }}
                />
                <OverflowItem
                  icon={Upload}
                  label="Import nodes"
                  onSelect={() => {
                    setIsOverflowOpen(false);
                    onImport();
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div
          className="w-px h-6 flex-shrink-0 bg-border dark:bg-border-dark mx-0.5"
          aria-hidden="true"
        />

        {/*
          The one control allowed to give ground. Everything else in this bar is
          `flex-shrink-0`, so when the canvas gets narrower than even the icon
          row wants, the environment name truncates instead of the Run button
          being pushed off the edge.
        */}
        <ButtonSelect
          key={`env-select-${workflowId ?? ""}`}
          options={buildEnvironmentOptions(environments)}
          value={selectedEnvironment || ""}
          onChange={onEnvironmentChange}
          placeholder="No Environment"
          containerClass="min-w-[6rem] max-w-[14rem]"
          buttonClass="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-sm bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none h-8 whitespace-nowrap"
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={onRefreshSwagger}
          disabled={!onRefreshSwagger || isSwaggerRefreshing}
          className="h-8 flex-shrink-0 whitespace-nowrap"
          icon={
            <RefreshCw
              className={`w-4 h-4 flex-shrink-0 ${isSwaggerRefreshing ? "animate-spin" : ""}`}
            />
          }
          title={isSwaggerRefreshing ? "Refreshing Swagger" : "Refresh Swagger"}
          aria-label="Refresh Swagger"
        >
          {showLabels && (
            <span>{isSwaggerRefreshing ? "Refreshing" : "Refresh"}</span>
          )}
        </Button>

        {workflowId !== undefined && workflowId !== "" && (
          <AgentLaunchButton
            scopeKind="workflow"
            scopeId={workflowId}
            className="flex-shrink-0"
            showLabel={showLabels}
            // The workflow view owns the agent panel, so a launch from here runs
            // in it. The store rather than a prop chain: the panel is a sibling
            // column of the canvas, not a child of this toolbar.
            onEmbeddedSession={openAgentSession}
          />
        )}

        <div
          className="w-px h-6 flex-shrink-0 bg-border dark:bg-border-dark mx-0.5"
          aria-hidden="true"
        />

        <div className="relative flex flex-shrink-0" ref={runMenuRef}>
          <Button
            variant="primary"
            intent={isRunning ? "warning" : "default"}
            size="sm"
            onClick={isRunning && onCancel ? onCancel : onRun}
            disabled={isRunning && !onCancel}
            className={
              RESUME_ENABLED
                ? "rounded-r-none h-8 whitespace-nowrap font-semibold border-r border-surface-raised/30 dark:border-surface-dark-raised/30"
                : "h-8 whitespace-nowrap font-semibold"
            }
            icon={
              isRunning ? (
                onCancel ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )
              ) : (
                <Play className="w-4 h-4" />
              )
            }
          >
            {isRunning ? (onCancel ? "Cancel" : "Running…") : "Run"}
          </Button>

          {RESUME_ENABLED && (
          <>
          <IconButton
            onClick={() => setIsRunMenuOpen((prev) => !prev)}
            disabled={isRunning}
            tooltip="Run options"
            variant={isRunning ? "warning" : "primary"}
            size="sm"
            className={[
              "h-8 rounded-l-none rounded-r-sm transition-colors border-l border-surface-raised/30 dark:border-surface-dark-raised/30",
              isRunning ? "cursor-wait" : "hover:brightness-110",
            ].join(" ")}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isRunMenuOpen ? "rotate-180" : ""}`}
            />
          </IconButton>

          {isRunMenuOpen && (
            <div className="absolute top-9 right-0 min-w-[280px] max-w-[360px] rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised shadow-node overflow-hidden z-50">
              <Button
                onClick={() => {
                  onRunFromLastFailed?.();
                  setIsRunMenuOpen(false);
                }}
                disabled={isRunning || !hasResumeOptions || isResumeLoading}
                variant="ghost"
                className="w-full rounded-none justify-start px-3 py-2 text-sm"
              >
                Run from last failed node
              </Button>

              <Button
                onClick={() => {
                  onRunAllFailed?.();
                  setIsRunMenuOpen(false);
                }}
                disabled={isRunning || !hasResumeOptions || isResumeLoading}
                variant="ghost"
                className="w-full rounded-none justify-start px-3 py-2 text-sm"
              >
                Run all failed nodes and continue
              </Button>

              <div className="w-full h-px bg-border dark:bg-border-dark" />

              {isResumeLoading && (
                <div className="px-3 py-2 text-xs text-text-muted dark:text-text-muted-dark">
                  Loading failed nodes…
                </div>
              )}

              {!isResumeLoading && !hasResumeOptions && (
                <div className="px-3 py-2 text-xs text-text-muted dark:text-text-muted-dark">
                  No failed run available.
                </div>
              )}

              {!isResumeLoading &&
                hasResumeOptions &&
                safeResumeOptions.map((opt) => (
                  <Button
                    key={opt.nodeId}
                    onClick={() => {
                      onRunFromFailedNode?.(opt.nodeId);
                      setIsRunMenuOpen(false);
                    }}
                    disabled={isRunning}
                    variant="ghost"
                    className="w-full rounded-none justify-start px-3 py-2 text-sm"
                    title={opt.nodeId}
                  >
                    {opt.label}
                  </Button>
                ))}
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  tooltip,
  showLabel = true,
}: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
      title={tooltip || label}
      aria-label={label}
      icon={<Icon className="w-4 h-4 flex-shrink-0" />}
    >
      {showLabel && <span>{label}</span>}
    </Button>
  );
}

function OverflowItem({
  icon: Icon,
  label,
  onSelect,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark" />
      {label}
    </button>
  );
}
