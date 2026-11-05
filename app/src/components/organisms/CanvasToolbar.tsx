import { useLayoutEffect, useRef, useState } from "react";
import {
  Save,
  History,
  ListChecks,
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
  FileSpreadsheet,
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from "@headlessui/react";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { Divider } from "../atoms/Divider";
import { IconButton } from "../atoms/IconButton";
import { Kbd } from "../atoms/Kbd";
import { Tooltip } from "../atoms/Tooltip";
import ButtonSelect from "../ButtonSelect";
import { AgentLaunchButton } from "./AgentLaunchButton";
import { useOpenAgentSession } from "../../hooks/useAgentDockControls";
import { useElementWidth } from "../../hooks/useElementWidth";
import { shortcutLabel } from "../../constants/keyboardShortcuts";
import useCanvasPrefsStore from "../../stores/CanvasPrefsStore";
import type { CanvasToolbarProps } from "../../types/CanvasToolbarProps";
import type { ToolbarButtonProps } from "../../types/ToolbarButtonProps";
import type { ToolbarDensity } from "../../types";
import { buildEnvironmentOptions, nextToolbarDensity, toolbarSlots } from "./canvasToolbarUtils";

const EMPTY_ENVIRONMENTS: Array<{ environmentId: string; name: string }> = [];
const EMPTY_RESUME_OPTIONS: NonNullable<CanvasToolbarProps["resumeOptions"]> =
  [];

/** The environment picker with its name showing. */
const ENVIRONMENT_TRIGGER_CLASS =
  "flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-xs bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none h-8 whitespace-nowrap";

/** The same picker at the last density step: a globe, named by its tooltip. */
const ENVIRONMENT_ICON_TRIGGER_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-xs bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none";

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
  const dataFileRef = useRef<HTMLInputElement>(null);
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
  const barRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<ToolbarDensity>("labels");

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
          <ToolbarButton
            icon={Save}
            label="Save"
            onClick={onSave}
            tooltip="Save workflow (Ctrl+S)"
            showLabel={showLabels}
          />
        </div>

        <ToolbarDivider />

        {showStructureInline && (
          <>
            <div className="flex shrink-0 items-center">
              {/* Icon-only at every density, like the camera lock: undo is a
                  reflex, and a reflex two clicks deep in an overflow menu is not
                  one. The disabled state is the only affordance telling you
                  whether there is anything left to undo. At the last tier the
                  bar has run out of room for that argument — the buttons move
                  into the menu so Run keeps its place. */}
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
            </div>

            <ToolbarDivider />

            <div className="flex shrink-0 items-center">
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
            </div>

            <ToolbarDivider />
          </>
        )}

        <div className="flex shrink-0 items-center">
          {showSecondaryInline && (
            <IconButton
              onClick={onCommandPalette}
              tooltip="Command palette (Ctrl+K)"
              aria-label="Open command palette"
              variant="ghost"
              size="sm"
            >
              <Command className="w-4 h-4" />
            </IconButton>
          )}
          {showHistoryInline && (
            <ToolbarButton
              icon={ListChecks}
              label="Run history"
              onClick={onHistory}
              tooltip="Run history"
              showLabel={showLabels}
            />
          )}
          {/* Icon-only at every density, like undo: it is the undo for what
              undo cannot reach — a save, an agent's edit, a sync. */}
          <IconButton
            onClick={onVersionHistory}
            tooltip="Version history"
            aria-label="Version history"
            variant="ghost"
            size="sm"
          >
            <History className="w-4 h-4" />
          </IconButton>
          {showSecondaryInline && (
            <>
              <ToolbarButton
                icon={Code}
                label="JSON"
                onClick={onJsonEditor}
                tooltip="JSON editor (Ctrl+J)"
                showLabel={showLabels}
              />
              <ToolbarButton
                icon={Upload}
                label="Import"
                onClick={onImport}
                tooltip="Import nodes"
                showLabel={showLabels}
              />
            </>
          )}
          {showOverflow && (
            <Menu>
              {/* `p-0!` rather than `p-0`: Button's size class sets
                  `padding-inline` after `padding`, so a plain `p-0` leaves the
                  32px box with 8px of content and squeezes the glyph. */}
              <MenuButton
                as={Button}
                variant="ghost"
                size="sm"
                aria-label="More actions"
                className="h-8 w-8 shrink-0 p-0!"
              >
                <MoreHorizontal className="h-4 w-4 shrink-0" />
              </MenuButton>

              <MenuItems
                anchor="bottom start"
                aria-label="More actions"
                className="z-50 min-w-[180px] overflow-hidden rounded-xs border border-border bg-surface-raised py-1 shadow-node focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised"
              >
                {!showStructureInline && (
                  <>
                    <OverflowItem
                      icon={Undo2}
                      label="Undo"
                      shortcut={shortcutLabel("undo")}
                      disabled={!canUndo}
                      onSelect={onUndo}
                    />
                    <OverflowItem
                      icon={Redo2}
                      label="Redo"
                      shortcut={shortcutLabel("redo")}
                      disabled={!canRedo}
                      onSelect={onRedo}
                    />
                    <OverflowItem
                      icon={Frame}
                      label="Frame selection"
                      shortcut={shortcutLabel("group")}
                      disabled={!canGroup}
                      onSelect={onGroup}
                    />
                    <OverflowItem
                      icon={Ungroup}
                      label="Ungroup selection"
                      shortcut={shortcutLabel("ungroup")}
                      disabled={!canUngroup}
                      onSelect={onUngroup}
                    />
                    <MenuSeparator className="h-px bg-border dark:bg-border-dark" />
                  </>
                )}
                <OverflowItem
                  icon={Command}
                  label="Command palette"
                  shortcut={shortcutLabel("openCommandPalette")}
                  onSelect={onCommandPalette}
                />
                {!showHistoryInline && (
                  <OverflowItem
                    icon={ListChecks}
                    label="Run history"
                    onSelect={onHistory}
                  />
                )}
                <OverflowItem
                  icon={Code}
                  label="JSON editor"
                  shortcut={shortcutLabel("toggleJsonEditor")}
                  onSelect={onJsonEditor}
                />
                <OverflowItem
                  icon={Upload}
                  label="Import nodes"
                  onSelect={onImport}
                />
              </MenuItems>
            </Menu>
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

        <ToolbarDivider />

        {/*
          The first control allowed to give ground. Everything else in this bar
          is `shrink-0`; at the labelled and icon tiers the environment name
          truncates instead of the Run button being pushed off the edge, and at
          the last tier the name goes entirely and the picker becomes a globe.
        */}
        <ButtonSelect
          key={`env-select-${workflowId ?? ""}`}
          options={buildEnvironmentOptions(environments)}
          value={selectedEnvironment || ""}
          onChange={onEnvironmentChange}
          placeholder="No Environment"
          iconOnly={!showEnvironmentLabel}
          icon={<Globe className="w-4 h-4" />}
          containerClass={showEnvironmentLabel ? "min-w-24 max-w-56" : "shrink-0"}
          buttonClass={
            showEnvironmentLabel
              ? ENVIRONMENT_TRIGGER_CLASS
              : ENVIRONMENT_ICON_TRIGGER_CLASS
          }
        />

        {hasOpenApiSource && (
          <Tooltip
            content={
              isSwaggerRefreshing
                ? "Refreshing from OpenAPI spec"
                : "Refresh from OpenAPI spec"
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshSwagger}
              disabled={!onRefreshSwagger || isSwaggerRefreshing}
              className="h-8 shrink-0 whitespace-nowrap"
              icon={
                <RefreshCw
                  className={`w-4 h-4 shrink-0 ${isSwaggerRefreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
              }
              aria-label="Refresh from OpenAPI spec"
            >
              {showLabels && (
                <span>
                  {isSwaggerRefreshing
                    ? "Refreshing from OpenAPI spec"
                    : "Refresh from OpenAPI spec"}
                </span>
              )}
            </Button>
          </Tooltip>
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

        <ToolbarDivider />

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
          <>
            <IconButton
              onClick={() => dataFileRef.current?.click()}
              disabled={isRunning}
              tooltip="Run with data… (CSV or JSON, once per row)"
              aria-label="Run with data"
              variant="ghost"
              size="sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
            </IconButton>
            <input
              ref={dataFileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              aria-label="Data file to run with"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so picking the same file again still fires.
                event.target.value = "";
                if (file) onRunWithData(file);
              }}
            />
          </>
        )}

        <div className="flex shrink-0">
          <Button
            variant="primary"
            intent={isRunning ? "warning" : "default"}
            size="sm"
            onClick={isRunning && onCancel ? onCancel : onRun}
            disabled={isRunning && !onCancel}
            className="rounded-l-xs rounded-r-none h-8 whitespace-nowrap font-semibold border-r border-surface-raised/30 dark:border-surface-dark-raised/30"
            icon={
              isRunning ? (
                onCancel ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                )
              ) : (
                <Play className="w-4 h-4" />
              )
            }
          >
            {isRunning ? (onCancel ? "Cancel" : "Running…") : "Run"}
          </Button>

          <Menu>
            {({ open }) => (
              <>
                <MenuButton
                  as={Button}
                  disabled={isRunning}
                  aria-label="Run options"
                  intent={isRunning ? "warning" : "default"}
                  size="sm"
                  className={[
                    "h-8 rounded-l-none rounded-r-xs px-2 transition-colors border-l border-surface-raised/30 dark:border-surface-dark-raised/30",
                    isRunning ? "cursor-wait" : "hover:brightness-110",
                  ].join(" ")}
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </MenuButton>

                <MenuItems
                  anchor="bottom end"
                  aria-label="Run options"
                  className="z-50 min-w-[280px] max-w-[360px] overflow-hidden rounded-xs border border-border bg-surface-raised py-1 shadow-node focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised"
                >
                  <ToolbarMenuItem
                    icon={RefreshCw}
                    label="Rerun failed branches"
                    disabled={isRunning || !hasResumeOptions || isResumeLoading}
                    hint={
                      isResumeLoading
                        ? "Loading failed nodes…"
                        : !hasResumeOptions
                          ? "No failed run to rerun."
                          : undefined
                    }
                    onSelect={() => onRerunFailed?.()}
                  />

                  {!isResumeLoading && hasResumeOptions && (
                    <>
                      <MenuSeparator className="h-px bg-border dark:bg-border-dark" />
                      {safeResumeOptions.map((opt) => (
                        <ToolbarMenuItem
                          key={opt.nodeId}
                          icon={Play}
                          label={`Run from ${opt.label}`}
                          title={opt.nodeId}
                          disabled={isRunning}
                          onSelect={() => onRunFromFailedNode?.(opt.nodeId)}
                        />
                      ))}
                    </>
                  )}
                </MenuItems>
              </>
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return (
    <Divider
      direction="vertical"
      role="separator"
      aria-orientation="vertical"
      data-testid="toolbar-divider"
      className="mx-1 self-stretch"
    />
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
    <Tooltip content={tooltip || label}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
        aria-label={label}
        icon={<Icon className="w-4 h-4 shrink-0" />}
      >
        {showLabel && <span>{label}</span>}
      </Button>
    </Tooltip>
  );
}

/** One row shared by the toolbar's menus: icon, label, optional chord hint. */
function ToolbarMenuItem({
  icon: Icon,
  label,
  shortcut,
  hint,
  title,
  onSelect,
  disabled = false,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string | undefined;
  readonly hint?: string | undefined;
  readonly title?: string | undefined;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <MenuItem
      as="button"
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={title}
      className={[
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
        "text-text-primary dark:text-text-primary-dark",
        "data-focus:bg-surface-overlay dark:data-focus:bg-surface-dark-overlay",
        "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:-outline-offset-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint !== undefined && (
          <span className="block text-xs text-text-secondary dark:text-text-secondary-dark">
            {hint}
          </span>
        )}
      </span>
      {shortcut !== undefined && (
        <Kbd className="shrink-0 pl-4">{shortcut}</Kbd>
      )}
    </MenuItem>
  );
}

function OverflowItem({
  icon: Icon,
  label,
  shortcut,
  onSelect,
  disabled = false,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <ToolbarMenuItem
      icon={Icon}
      label={label}
      shortcut={shortcut}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}
