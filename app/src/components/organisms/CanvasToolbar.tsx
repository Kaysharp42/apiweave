import { useLayoutEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { CanvasToolbarButton } from "./CanvasToolbarButton";
import { CanvasToolbarDivider } from "./CanvasToolbarDivider";
import { CanvasToolbarEnvironmentPicker } from "./CanvasToolbarEnvironmentPicker";
import { CanvasToolbarRefreshButton } from "./CanvasToolbarRefreshButton";
import { CanvasToolbarRunControls } from "./CanvasToolbarRunControls";
import { CanvasToolbarSecondaryActions } from "./CanvasToolbarSecondaryActions";
import { CanvasToolbarStructureActions } from "./CanvasToolbarStructureActions";
import { AgentLaunchButton } from "./AgentLaunchButton";
import { useOpenAgentSession } from "../../hooks/useAgentDockControls";
import { useElementWidth } from "../../hooks/useElementWidth";
import { shortcutLabel } from "../../constants/keyboardShortcuts";
import type { CanvasToolbarProps, ToolbarDensity } from "../../types";
import { nextToolbarDensity, toolbarSlots } from "./canvasToolbarUtils";

const EMPTY_ENVIRONMENTS: Array<{ environmentId: string; name: string }> = [];
const EMPTY_RESUME_OPTIONS: NonNullable<CanvasToolbarProps["resumeOptions"]> =
  [];

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
  onVersionHistory,
  onJsonEditor,
  onImport,
  onCommandPalette,
  onRun,
  onRunWithData,
  onLoad,
  onCancel,
  onRerunFailed,
  onRunFromFailedNode,
  isRunning = false,
  iteration = null,
  environments = EMPTY_ENVIRONMENTS,
  selectedEnvironment,
  onEnvironmentChange,
  onRefreshSwagger,
  isSwaggerRefreshing = false,
  hasOpenApiSource = false,
  workflowId,
  resumeOptions = EMPTY_RESUME_OPTIONS,
  isResumeLoading = false,
}: CanvasToolbarProps) {
  const openAgentSession = useOpenAgentSession();

  // Measured on the track, not the bar: the bar is content-sized, so asking it
  // how wide it is only ever answers "as wide as I want to be".
  const [trackRef, availableWidth] = useElementWidth<HTMLDivElement>();
  const barRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<ToolbarDensity>("labels");
  const safeResumeOptions = resumeOptions ?? EMPTY_RESUME_OPTIONS;

  // Every width change re-opens the question at the top tier, so widening the
  // canvas gets the labels back instead of leaving the bar stuck in whatever
  // tier it last fell to.
  useLayoutEffect(() => {
    setDensity("labels");
  }, [availableWidth]);

  // ...and then step down until it actually fits. This asks the bar whether it
  // overflowed rather than comparing the track against a hard-coded "labels
  // need 860px", which is the bug: that constant went stale the first time a
  // button was added here, and the bar spilled past the canvas edge at a width
  // the threshold still called roomy. Resizing the window was the only thing
  // that made it re-measure.
  //
  // No dependency array on purpose — the bar's natural width also moves with
  // its content (an agent name, a "Running…" label), not just with the canvas.
  // It terminates because `nextToolbarDensity("compact")` is `"compact"`, and
  // React bails out of a re-render when the state does not change.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    // +1: subpixel layout widths report a half-pixel overflow that is not one.
    if (bar.scrollWidth > bar.clientWidth + 1) {
      // A concrete next tier, not an updater: the effect already knows the tier
      // it measured, and an updater can be handed the state from before the
      // previous step (which left the bar stuck one tier short).
      setDensity(nextToolbarDensity(density));
    }
  });
  const showLabels = density === "labels";
  const {
    showSecondaryInline,
    showHistoryInline,
    showStructureInline,
    showEnvironmentLabel,
    showOverflow,
  } = toolbarSlots(density);

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
        ref={barRef}
        className="pointer-events-auto flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 px-2 py-1.5 rounded-xs bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark shadow-node"
        role="toolbar"
        aria-label="Workflow actions"
        data-density={density}
      >
        <div className="flex shrink-0 items-center">
          <CanvasToolbarButton
            icon={Save}
            label="Save"
            onClick={onSave}
            tooltip={`Save workflow (${shortcutLabel("save")})`}
            showLabel={showLabels}
          />
        </div>

        <CanvasToolbarDivider />

        {showStructureInline && (
          <CanvasToolbarStructureActions
            canUndo={canUndo}
            canRedo={canRedo}
            canGroup={canGroup}
            canUngroup={canUngroup}
            onUndo={onUndo}
            onRedo={onRedo}
            onGroup={onGroup}
            onUngroup={onUngroup}
          />
        )}

        <CanvasToolbarSecondaryActions
          showLabels={showLabels}
          showSecondaryInline={showSecondaryInline}
          showHistoryInline={showHistoryInline}
          showOverflow={showOverflow}
          onCommandPalette={onCommandPalette}
          onHistory={onHistory}
          onVersionHistory={onVersionHistory}
          onJsonEditor={onJsonEditor}
          onImport={onImport}
          overflow={{
            showStructureInline,
            canUndo,
            canRedo,
            canGroup,
            canUngroup,
            onUndo,
            onRedo,
            onGroup,
            onUngroup,
            onCommandPalette,
            showHistoryInline,
            onHistory,
            onJsonEditor,
            onImport,
          }}
        />

        <CanvasToolbarDivider />

        <CanvasToolbarEnvironmentPicker
          environments={environments}
          selectedEnvironment={selectedEnvironment || ""}
          onEnvironmentChange={onEnvironmentChange}
          showLabel={showEnvironmentLabel}
          workflowId={workflowId}
        />

        {hasOpenApiSource && (
          <CanvasToolbarRefreshButton
            onRefreshSwagger={onRefreshSwagger}
            isSwaggerRefreshing={isSwaggerRefreshing}
            showLabel={showLabels}
          />
        )}

        {workflowId !== undefined && workflowId !== "" && (
          <AgentLaunchButton
            scopeKind="workflow"
            scopeId={workflowId}
            className="shrink-0"
            showLabel={showLabels}
            // The workflow view owns the agent panel, so a launch from here runs
            // in it. The store rather than a prop chain: the panel is a sibling
            // column of the canvas, not a child of this toolbar.
            onEmbeddedSession={openAgentSession}
          />
        )}

        <CanvasToolbarDivider />

        <CanvasToolbarRunControls
          onRun={onRun}
          onRunWithData={onRunWithData}
          onLoad={onLoad}
          onCancel={onCancel}
          onRerunFailed={onRerunFailed}
          onRunFromFailedNode={onRunFromFailedNode}
          isRunning={isRunning}
          iteration={iteration}
          resumeOptions={safeResumeOptions}
          isResumeLoading={isResumeLoading}
        />
      </div>
    </div>
  );
}
