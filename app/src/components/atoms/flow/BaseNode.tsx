import React, { useState } from "react";
import { Handle, Position } from "reactflow";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  Minus,
  RotateCw,
  X,
} from "lucide-react";
import { NodeActionMenu } from "./NodeActionMenu";
import { NodeRunStrip } from "./NodeRunStrip";
import useCanvasStore from "../../../stores/CanvasStore";
import type { NodeStatus } from "../../../types/NodeStatus";
import type { BaseNodeProps } from "../../../types/BaseNodeProps";

/**
 * The node slab — the shared shell behind every canvas node.
 *
 * Quiet at rest, informative in motion (DESIGN.md §7). An idle node is a soft
 * slab carrying an icon tile, a title, and one muted rest line; it has no glow,
 * no ring and no animation, which is what bounds glow cost by run concurrency
 * rather than node count. A running node is the brightest thing on the canvas.
 *
 * Status is drawn **once**: a single 16px affordance plus the border and glow
 * that state implies. Not a badge and a dot and an icon.
 */

interface StatusPresentation {
  /** Border colour. color-mix against the status token so both themes are right. */
  border: string;
  /** Glow shadow token for the glow layer, or null for a flat state. */
  glow: string | null;
  /** Animation applied to the glow layer. */
  glowMotion: string;
  /** Base opacity of the glow layer, before any animation. */
  glowRest: string;
  affordance: React.ReactNode;
  ariaLabel: string;
}

const AFFORDANCE_CLASS = "w-4 h-4 flex-shrink-0";

const statusConfig: Record<NodeStatus, StatusPresentation> = {
  idle: {
    border: "border-border dark:border-border-dark",
    glow: null,
    glowMotion: "",
    glowRest: "",
    affordance: (
      <Circle
        className={`${AFFORDANCE_CLASS} text-text-muted dark:text-text-muted-dark`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Idle",
  },
  running: {
    border: "border-[color-mix(in_srgb,var(--aw-status-running)_70%,transparent)]",
    glow: "shadow-glow-running",
    // Opacity on a dedicated layer — never box-shadow on the node itself.
    glowMotion: "animate-node-breathe motion-reduce:animate-none",
    glowRest: "opacity-100",
    affordance: (
      <Loader2
        className={`${AFFORDANCE_CLASS} animate-spin motion-reduce:animate-none text-[var(--aw-status-running)]`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Running",
  },
  success: {
    border: "border-[color-mix(in_srgb,var(--aw-status-success)_40%,transparent)]",
    glow: "shadow-glow-success",
    // Success settles: the layer starts hidden and the animation drives 1 → 0
    // over 600ms. Under reduced motion the animation is off and the resting
    // opacity-0 leaves a calm, unlit node — which is the correct end state.
    glowMotion: "animate-node-settle motion-reduce:animate-none",
    glowRest: "opacity-0",
    affordance: (
      <Check
        className={`${AFFORDANCE_CLASS} text-[var(--aw-status-success)]`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Success",
  },
  error: {
    border: "border-[color-mix(in_srgb,var(--aw-status-error)_70%,transparent)]",
    // Failure persists. On a finished canvas the only lit thing is what broke.
    glow: "shadow-glow-error",
    glowMotion: "",
    glowRest: "opacity-100",
    affordance: (
      <X
        className={`${AFFORDANCE_CLASS} text-[var(--aw-status-error)]`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Error",
  },
  warning: {
    border: "border-[color-mix(in_srgb,var(--aw-status-warning)_70%,transparent)]",
    glow: "shadow-glow-warning",
    glowMotion: "",
    glowRest: "opacity-100",
    affordance: (
      <RotateCw
        className={`${AFFORDANCE_CLASS} text-[var(--aw-status-warning)]`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Warning",
  },
  skipped: {
    border: "border-border dark:border-border-dark",
    glow: null,
    glowMotion: "",
    glowRest: "",
    // Never a check. A skipped node did not succeed.
    affordance: (
      <Minus
        className={`${AFFORDANCE_CLASS} text-text-muted dark:text-text-muted-dark`}
        aria-hidden="true"
      />
    ),
    ariaLabel: "Skipped",
  },
};

/** True once the node has something to report — the run strip's precondition. */
function hasRun(status: NodeStatus): boolean {
  return status === "running" || status === "success" || status === "error" || status === "warning";
}

export function BaseNode({
  children,
  title,
  icon,
  status = "idle",
  selected = false,
  handleLeft = false,
  handleRight = false,
  extraHandles = null,
  nodeId,
  collapsible = true,
  defaultExpanded = false,
  showMenu = true,
  presetNodeType,
  tileHue,
  typeChip = null,
  restLine,
  activityLine,
  resultSummary,
  metrics,
  progress = null,
  className = "",
  titleExtra = null,
}: BaseNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const config = statusConfig[status] ?? statusConfig.idle;
  const running = hasRun(status);

  // The icon tile's hue arrives as a token reference (`var(--aw-method-post)`)
  // and is wired in as a custom property, so the tint and the icon colour stay
  // single-sourced and no colour literal enters the component.
  const tileStyle = tileHue
    ? ({ "--aw-node-tile-hue": tileHue } as React.CSSProperties)
    : undefined;

  const chip = typeChip ?? titleExtra;

  const body = (
    <>
      {running && (
        <NodeRunStrip
          status={status}
          {...(activityLine && { activityLine })}
          {...(resultSummary && { resultSummary })}
          {...(metrics && { metrics })}
          progress={progress}
        />
      )}

      {!running && status === "skipped" && (
        <div className="px-3 py-2 font-mono text-xs leading-tight text-text-muted dark:text-text-muted-dark">
          skipped
        </div>
      )}

      {!running && status !== "skipped" && restLine && (
        <div className="flex items-baseline gap-1.5 px-3 py-2 font-mono text-xs leading-tight">
          <span className="flex-shrink-0 text-text-secondary dark:text-text-secondary-dark">
            {restLine.operation}
          </span>
          {restLine.argument && (
            <span
              className="truncate text-text-muted dark:text-text-muted-dark"
              title={restLine.argument}
            >
              {restLine.argument}
            </span>
          )}
        </div>
      )}

      {children && typeof children === "function"
        ? children({ isExpanded, setIsExpanded })
        : children && <div className="p-3">{children}</div>}
    </>
  );

  const hasBody =
    running ||
    status === "skipped" ||
    restLine !== undefined ||
    children !== undefined;

  return (
    <>
      {handleLeft && (
        <Handle
          type={handleLeft.type ?? "target"}
          position={Position.Left}
          id={handleLeft.id ?? ""}
          style={handleLeft.style ?? {}}
          className="!w-3 !h-3 !bg-[var(--aw-primary)] !border !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-raised)] !rounded-full"
        />
      )}

      {/* The wrapper exists so the glow layer sits outside the slab's
          overflow-hidden, which would otherwise clip its halo. It also carries
          the selection ring, which composes with the state glow rather than
          replacing it. */}
      <div
        className={[
          "relative rounded-node",
          selected ? "shadow-glow-select" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {config.glow && (
          <div
            // Keyed on status so a state change restarts the animation rather
            // than resuming a half-finished settle.
            key={status}
            aria-hidden="true"
            // Stable contract for tests: an idle node must have no glow layer
            // at all. Asserting on this beats asserting on shadow class names.
            data-node-glow={status}
            className={[
              "pointer-events-none absolute inset-0 rounded-node",
              config.glow,
              config.glowRest,
              config.glowMotion,
            ]
              .filter(Boolean)
              .join(" ")}
          />
        )}

        <div
          className={[
            "relative flex flex-col rounded-node border min-w-[180px] max-w-node overflow-hidden bg-surface-raised dark:bg-surface-dark-raised shadow-node-raised",
            "transition-colors duration-aw-fast ease-aw-standard motion-reduce:transition-none",
            config.border,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ fontSize: "12px" }}
          aria-label={`Node status: ${config.ariaLabel}`}
        >
          {title && (
            <div
              className={[
                "flex items-center gap-2 px-3 py-2",
                hasBody ? "border-b border-border dark:border-border-dark" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {icon && (
                <span
                  className={[
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-node-tile",
                    tileHue
                      ? "bg-[color-mix(in_srgb,var(--aw-node-tile-hue)_12%,transparent)] text-[var(--aw-node-tile-hue)]"
                      : "bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark",
                  ].join(" ")}
                  {...(tileStyle && { style: tileStyle })}
                >
                  {icon}
                </span>
              )}

              <span
                className="flex-1 truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-text-primary dark:text-text-primary-dark"
                title={title}
              >
                {title}
              </span>

              {chip}

              <span className="flex flex-shrink-0 items-center">
                {config.affordance}
              </span>

              {showMenu && nodeId && (
                <NodeActionMenu
                  nodeId={nodeId}
                  collapsible={collapsible}
                  isExpanded={isExpanded}
                  presetable={presetNodeType !== undefined}
                  onDuplicate={(id: string) =>
                    useCanvasStore.getState().duplicateNode(id)
                  }
                  onCopy={(id: string) => useCanvasStore.getState().copyNode(id)}
                  onSaveAsPreset={(id: string) =>
                    useCanvasStore.getState().savePresetFromNode(id)
                  }
                  onToggleExpand={(nextExpanded: boolean) =>
                    setIsExpanded(nextExpanded)
                  }
                />
              )}

              {collapsible && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1 rounded-node-ctl text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay nodrag focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer transition-colors motion-reduce:transition-none"
                  style={{
                    background: "transparent",
                    border: "none",
                    WebkitTapHighlightColor: "transparent",
                  }}
                  aria-expanded={isExpanded}
                  title={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          )}

          {body}
        </div>
      </div>

      {handleRight && (
        <Handle
          type={handleRight.type ?? "source"}
          position={Position.Right}
          id={handleRight.id ?? ""}
          style={handleRight.style ?? {}}
          className="!w-3 !h-3 !bg-[var(--aw-primary)] !border !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-raised)] !rounded-full"
        />
      )}

      {extraHandles}
    </>
  );
}
