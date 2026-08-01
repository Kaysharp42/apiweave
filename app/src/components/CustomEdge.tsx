import { memo, useMemo, type CSSProperties } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useStore,
  type EdgeProps,
} from "reactflow";
import { X } from "lucide-react";
import type { NodeStatus } from "../types/NodeStatus";

interface CustomEdgeData {
  animated?: boolean;
}

type CustomEdgeProps = EdgeProps<CustomEdgeData>;

const EMPTY_EDGE_STYLE: CSSProperties = {};

export interface EdgePresentation {
  stroke: string;
  strokeWidth: number;
  dash: string | undefined;
  /** Whether control is currently passing through this edge. */
  flowing: boolean;
}

/**
 * An edge takes its state from the node it leaves. Idle plumbing is a
 * hairline; a live edge is the path the run is taking (DESIGN.md §7).
 */
export function presentationFor(status: NodeStatus): EdgePresentation {
  switch (status) {
    case "running":
      return {
        stroke: "var(--aw-status-running)",
        strokeWidth: 1.5,
        dash: undefined,
        flowing: true,
      };
    case "success":
      return {
        stroke:
          "color-mix(in srgb, var(--aw-status-success) 55%, transparent)",
        strokeWidth: 1.5,
        dash: undefined,
        flowing: false,
      };
    case "error":
      return {
        stroke: "var(--aw-status-error)",
        strokeWidth: 1.5,
        dash: undefined,
        flowing: false,
      };
    case "warning":
      return {
        stroke: "var(--aw-status-warning)",
        strokeWidth: 1.5,
        dash: undefined,
        flowing: false,
      };
    case "skipped":
      return {
        stroke: "var(--aw-border)",
        strokeWidth: 1,
        dash: "2 6",
        flowing: false,
      };
    default:
      return {
        stroke: "var(--aw-border)",
        strokeWidth: 1,
        dash: undefined,
        flowing: false,
      };
  }
}

function CustomEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = EMPTY_EDGE_STYLE,
  markerEnd,
}: CustomEdgeProps) {
  const { deleteElements } = useReactFlow();

  /**
   * Read the source node's status straight from the store rather than
   * duplicating it onto every edge's data. One source of truth, no edge-sync
   * pass on every status change, and nothing to go stale. The selector returns
   * a string, so an edge only re-renders when its own source changes state.
   */
  const sourceStatus = useStore((state) => {
    const node = state.nodeInternals.get(source);
    const status = (node?.data as { executionStatus?: string } | undefined)
      ?.executionStatus;
    return (status ?? "idle") as NodeStatus;
  });

  const [edgePath, labelX, labelY] = useMemo(
    () =>
      getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  );

  const presentation = presentationFor(sourceStatus);

  // The assertion pass/fail branches carry their own semantic colour, set by
  // `workflowCanvas.ts`. Those keep it; only the width and the dot follow state.
  const semanticStroke = style.stroke;
  const stroke = semanticStroke ?? presentation.stroke;
  // Flow is a fact about the run, not a per-edge flag. The old `data.animated`
  // marked assertion branches as permanently animated, which meant the canvas
  // was always in motion whether or not anything was executing.
  const flowing = presentation.flowing;

  const onEdgeDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd ?? ""}
        style={{
          ...style,
          stroke,
          strokeWidth: presentation.strokeWidth,
          ...(presentation.dash ? { strokeDasharray: presentation.dash } : {}),
        }}
      />

      {flowing && (
        <circle
          className="aw-edge-flow-dot animate-edge-flow motion-reduce:hidden"
          r={3}
          cx={0}
          cy={0}
          fill={stroke}
          style={{ offsetPath: `path("${edgePath}")` }}
        />
      )}

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan group/edge"
        >
          {/*
            Revealed on edge hover or on keyboard focus. `focus-within` is what
            makes this reachable at all: the button stays in the tab order and
            uncovers itself when focused, where the previous `hover:opacity-100`
            left edge deletion mouse-only.
          */}
          <div className="flex items-center opacity-0 transition-opacity duration-aw-fast ease-aw-standard group-hover/edge:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded-node-rail border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark shadow-overlay transition-colors duration-aw-fast ease-aw-standard hover:text-[var(--aw-status-error)] hover:border-[var(--aw-status-error)] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none cursor-pointer"
              onClick={onEdgeDelete}
              title="Delete edge"
              aria-label="Delete edge"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(CustomEdge);
