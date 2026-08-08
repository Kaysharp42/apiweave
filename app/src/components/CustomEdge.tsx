import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import type { EdgePresentation } from "../types/EdgePresentation";
import type { EdgePhase } from "../types/EdgePhase";

interface CustomEdgeData {
  animated?: boolean;
}

type CustomEdgeProps = EdgeProps<CustomEdgeData>;

const EMPTY_EDGE_STYLE: CSSProperties = {};

/**
 * How far the colour creeps out of a working node before control actually
 * leaves it. Small enough to read as "armed", not as "already arrived".
 *
 * The single source for this value: the dash overlay parks at `1 - ARM` and the
 * travelling head starts its run from `ARM`, so the head never appears behind
 * the colour it is supposed to be laying down.
 */
const ARM_FRACTION = 0.12;

/** Untraversed plumbing vs. a path the run has taken. */
const IDLE_WIDTH = 1;

/**
 * Nothing is written on an edge.
 *
 * A `pass` branch used to be painted in the success token, which put run
 * colour on a canvas that had never been run — a resting pass branch was
 * `--aw-status-success` at 35%, a traversed one the same token at 55%, and
 * nobody can tell those apart. Colour on an edge now means one thing: control
 * went through here.
 *
 * The branch is identified where it starts, by the pass/fail socket it leaves
 * (`AssertionNode.tsx` pins those green and red, with a name on hover). A chip
 * repeating that mid-path was tried and dropped: bezier midpoints sit nowhere
 * near the edge on a fanned-out graph, so the labels read as free-floating
 * badges rather than as anything attached to a branch.
 */

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
        phase: "armed",
      };
    case "success":
      return {
        stroke:
          "color-mix(in srgb, var(--aw-status-success) 55%, transparent)",
        strokeWidth: 1.5,
        dash: undefined,
        phase: "traversed",
      };
    case "error":
      return {
        stroke: "var(--aw-status-error)",
        strokeWidth: 1.5,
        dash: undefined,
        phase: "traversed",
      };
    case "warning":
      return {
        stroke: "var(--aw-status-warning)",
        strokeWidth: 1.5,
        dash: undefined,
        phase: "traversed",
      };
    case "skipped":
      return {
        stroke: "var(--aw-border)",
        strokeWidth: IDLE_WIDTH,
        dash: "2 6",
        phase: "resting",
      };
    default:
      return {
        stroke: "var(--aw-border)",
        strokeWidth: IDLE_WIDTH,
        dash: undefined,
        phase: "resting",
      };
  }
}

/** Where the dash overlay parks for a phase, as a fraction of the path. */
function revealOffset(presentation: EdgePresentation): number {
  switch (presentation.phase) {
    case "traversed":
      return 0;
    case "armed":
      return 1 - ARM_FRACTION;
    default:
      return 1;
  }
}

type FillAction =
  /** A run reset takes the canvas back to quiet: the previous run's colours
   * are history, not context for the next one. */
  | { kind: "reset" }
  /** Not yet traversed (idle or armed): no fill to show. */
  | { kind: "hold" }
  /** Mounting straight into `traversed` is a finished run being reloaded.
   * Nothing travelled, so nothing animates. */
  | { kind: "settled" }
  /** Control just finished crossing: start the reveal. */
  | { kind: "fill" };

/** What a phase transition should do to the fill overlay, decided from the
 * phase alone — the caller supplies the trail colour to paint. */
function fillActionFor(phase: EdgePhase, previousPhase: EdgePhase): FillAction {
  if (phase === "resting") return { kind: "reset" };
  if (phase !== "traversed") return { kind: "hold" };
  if (previousPhase === "traversed") return { kind: "settled" };
  return { kind: "fill" };
}

interface EdgeFillState {
  /**
   * A traversal is in flight: the head is travelling and the colour behind it
   * is being laid down. Cleared by the overlay's own `transitionend`, so the
   * duration is stated once, in CSS, and nothing here can drift from it.
   */
  filling: boolean;
  /**
   * What this edge showed the last time control finished passing through it.
   * The new colour advances *over* it, so a node that succeeds and then fails
   * on retry repaints from the source outward with its previous result still
   * visible ahead of the head — rather than the whole path flipping at once.
   */
  trail: string | null;
  /** The overlay's own `transitionend` says the reveal has finished playing. */
  stopFilling: () => void;
}

/** Owns the fill/trail state machine for one edge's phase transitions. Split
 * out of `CustomEdge` so the render stays a single, easily-scanned hook call. */
function useEdgeFill(phase: EdgePhase, stroke: string): EdgeFillState {
  const [filling, setFilling] = useState(false);
  const [trail, setTrail] = useState<string | null>(null);

  const lastPhase = useRef(phase);
  const lastTraversed = useRef<string | null>(phase === "traversed" ? stroke : null);

  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = phase;

    switch (fillActionFor(phase, previous).kind) {
      case "reset":
        lastTraversed.current = null;
        setTrail(null);
        setFilling(false);
        break;
      case "hold":
        setFilling(false);
        break;
      case "settled":
        break;
      case "fill":
        setTrail(lastTraversed.current);
        setFilling(true);
        break;
    }
  }, [phase]);

  // Runs after the effect above, so a fill starting this commit still reads the
  // *previous* traversed colour as its trail.
  useEffect(() => {
    if (phase === "traversed") lastTraversed.current = stroke;
  }, [phase, stroke]);

  const stopFilling = useCallback(() => setFilling(false), []);

  return { filling, trail, stopFilling };
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
  markerEnd = "",
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

  // Run state is the *only* input to an edge's colour: not the handle it
  // leaves, and nothing carried on `style` — see the note above the table.
  const stroke = presentation.stroke;

  const { filling, trail, stopFilling } = useEdgeFill(presentation.phase, stroke);

  const restStroke = trail ?? "var(--aw-border)";

  const onEdgeDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: restStroke,
          strokeWidth: trail ? presentation.strokeWidth : IDLE_WIDTH,
          strokeDasharray: presentation.dash,
        }}
      />

      {/*
        The state overlay. Always mounted, even at rest, because a reveal can
        only animate on an element that was already there — mounting it at
        `strokeDashoffset: 0` would snap the edge to its final colour, which is
        the instant flip this replaces.

        `pathLength={1}` normalises the dash maths to a fraction of the path, so
        one offset value is correct for an edge of any length.
      */}
      <path
        className="aw-edge-fill"
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={presentation.strokeWidth}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={revealOffset(presentation)}
        onTransitionEnd={(event) => {
          if (event.propertyName === "stroke-dashoffset") stopFilling();
        }}
      />

      {/*
        The head of the fill, not a courier doing laps. It is mounted only for
        the length of one traversal and takes its duration from the same token
        as the reveal, so the two stay locked together.
      */}
      {filling && (
        <circle
          className="aw-edge-flow-dot animate-edge-fill motion-reduce:hidden"
          r={3}
          cx={0}
          cy={0}
          fill={stroke}
          style={
            {
              offsetPath: `path("${edgePath}")`,
              "--aw-edge-arm": `${ARM_FRACTION * 100}%`,
            } as CSSProperties
          }
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
