import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import { BROWSER_ACTIONS } from "./browserStep";
import { absoluteNodePosition, FRAME_NODE_TYPE, GROUP_PAD } from "./canvasGroups";

/** Steps per row inside a recording's frame, so a long recording wraps instead of running off the canvas. */
const COLUMNS = 5;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 190;
/** Room for the frame's label pill above the first row. */
const FRAME_HEADER = 36;
/** How far below its anchor a recording's frame starts, clear of the anchor and what follows it. */
const FRAME_OFFSET_Y = 200;

/** The step's title on the canvas: the action's name, as the palette names it. */
export function recordedStepLabel(action: string): string {
  return BROWSER_ACTIONS.find((entry) => entry.value === action)?.label ?? "Browser step";
}

function frameSize(count: number): { width: number; height: number } {
  const columns = Math.max(1, Math.min(count, COLUMNS));
  const rows = Math.max(1, Math.ceil(count / COLUMNS));
  return {
    width: GROUP_PAD * 2 + columns * CELL_WIDTH - 40,
    height: GROUP_PAD * 2 + FRAME_HEADER + rows * CELL_HEIGHT - 50,
  };
}

function cellPosition(index: number): { x: number; y: number } {
  return {
    x: GROUP_PAD + (index % COLUMNS) * CELL_WIDTH,
    y: GROUP_PAD + FRAME_HEADER + Math.floor(index / COLUMNS) * CELL_HEIGHT,
  };
}

/** A new config for a step already on the canvas; its title follows the action unless the user renamed it. */
function updateStep(nodes: readonly CanvasNode[], step: RecordedBrowserStep): CanvasNode[] {
  return nodes.map((node) => {
    if (node.id !== step.stepId) return node;
    const previous = typeof node.data.config?.["action"] === "string" ? node.data.config["action"] : "";
    const renamed = node.data.label !== recordedStepLabel(previous);
    return {
      ...node,
      // A new `data` object: auto-save tells edits apart by its identity.
      data: { ...node.data, config: step.config, ...(renamed ? {} : { label: recordedStepLabel(step.config.action) }) },
    };
  });
}

/**
 * Put one recorded step on the canvas, or update it when it is already there.
 *
 * `inserted` lists the steps of this recording already placed, in order. A
 * new step goes into the recording's frame (created with the first one, below
 * the anchor) and is connected after the previous step, or after the anchor.
 * What the anchor led to follows the last step: recording after Start in a
 * Start → End workflow gives Start → steps → End. That splice only happens
 * when the anchor has exactly one plain outgoing edge; a branching anchor
 * keeps its edges and gains one more.
 *
 * A step the user deleted while recording is not put back: its updates are
 * ignored, and the next step connects to the last one still there.
 *
 * A step already on the canvas is always an update, even when `inserted` is
 * empty: a renderer reload loses that list, and inserting the step again would
 * give React Flow two nodes with one id.
 */
export function placeRecordedStep(
  graph: CanvasGraph,
  step: RecordedBrowserStep,
  placement: RecordingPlacement,
  inserted: readonly string[],
): CanvasGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  if (inserted.includes(step.stepId) || byId.has(step.stepId)) {
    return { nodes: updateStep(graph.nodes, step), edges: graph.edges };
  }

  const anchor = byId.get(placement.anchorId);
  let nodes = [...graph.nodes];
  let frame = byId.get(placement.frameId);
  if (frame === undefined) {
    const origin = anchor === undefined ? { x: 0, y: 0 } : absoluteNodePosition(anchor, byId);
    frame = {
      id: placement.frameId,
      type: FRAME_NODE_TYPE,
      position: { x: origin.x, y: origin.y + FRAME_OFFSET_Y },
      ...frameSize(1),
      data: { label: placement.frameLabel, config: {} },
      selectable: true,
      dragHandle: ".aw-group-handle",
    };
    // A frame precedes what it holds in the array: React Flow's contract.
    nodes = [frame, ...nodes];
  }

  const placed = nodes.filter((node) => node.parentId === placement.frameId).length;
  const node: CanvasNode = {
    id: step.stepId,
    type: "browser",
    position: cellPosition(placed),
    parentId: placement.frameId,
    extent: "parent",
    data: { label: recordedStepLabel(step.config.action), config: step.config },
  };
  const frameId = frame.id;
  nodes = [...nodes.map((candidate) => (candidate.id === frameId ? { ...candidate, ...frameSize(placed + 1) } : candidate)), node];

  const previous = [...inserted].reverse().find((id) => byId.has(id)) ?? (anchor === undefined ? undefined : anchor.id);
  // Never an edge from a node to itself: a self-loop is what a duplicate id
  // would leave behind, and React Flow cannot run one.
  if (previous === undefined || previous === step.stepId) return { nodes, edges: graph.edges };
  const outgoing = graph.edges.filter((edge) => edge.source === previous);
  const follows = previous !== placement.anchorId || (outgoing.length === 1 && outgoing[0]?.sourceHandle == null) ? outgoing : [];
  const moved = new Set(follows.map((edge) => edge.id));
  const edges: CanvasEdge[] = [
    ...graph.edges.map((edge) => (moved.has(edge.id) ? { ...edge, source: step.stepId } : edge)),
    { id: `edge-${step.stepId}`, source: previous, target: step.stepId, type: "custom" },
  ];
  return { nodes, edges };
}
