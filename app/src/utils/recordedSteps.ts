import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import { browserActionLabel, browserStepLabel } from "@shared/browser/browser_action_labels";
import { absoluteNodePosition, FRAME_NODE_TYPE, GROUP_PAD } from "./canvasGroups";

/** Steps per row inside a recording's frame, so a long recording wraps instead of running off the canvas. */
const COLUMNS = 5;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 190;
/** Room for the frame's label pill above the first row. */
const FRAME_HEADER = 36;
/** How far below its anchor a recording's frame starts, clear of the anchor and what follows it. */
const FRAME_OFFSET_Y = 200;
/** How far right of a recording's frame, at its widest, an End it adds goes. */
const END_GAP_X = 80;

/** The step's generated title on the canvas: the action and what it acts on, e.g. "Fill Email". */
export function recordedStepLabel(config: unknown): string {
  return browserStepLabel(config);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a step's title is still one the recorder generated from `config` (or
 * empty), so it may follow a new config: the title it writes now ("Fill
 * Email"), or the action's own words an older recording saved before titles
 * named their target ("Type into a field", "Click"). A title the user typed is
 * theirs and is never overwritten.
 */
export function hasGeneratedLabel(label: unknown, config: unknown): boolean {
  if (label === undefined || label === "") return true;
  if (label === recordedStepLabel(config)) return true;
  const action = isRecord(config) && typeof config["action"] === "string" ? config["action"] : "";
  return label === browserActionLabel(action);
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

/**
 * The first grid cell no node in the frame sits on, each node counted on the
 * cell nearest its position. A fresh recording's frame fills in order; a frame
 * a re-record goes back into keeps the steps still in it where they are, and
 * the new ones take the cells the replaced steps left, then the cells after.
 */
function firstFreeCell(children: readonly CanvasNode[]): number {
  const taken = new Set(
    children.map((child) => {
      const column = Math.max(0, Math.min(COLUMNS - 1, Math.round((child.position.x - GROUP_PAD) / CELL_WIDTH)));
      const row = Math.max(0, Math.round((child.position.y - GROUP_PAD - FRAME_HEADER) / CELL_HEIGHT));
      return row * COLUMNS + column;
    }),
  );
  let cell = 0;
  while (taken.has(cell)) cell++;
  return cell;
}

/** The frame made big enough for `cells` grid cells; never smaller than it is, so a size the user gave it stays. */
function grownToHold(frame: CanvasNode, cells: number): CanvasNode {
  const needed = frameSize(cells);
  return { ...frame, width: Math.max(frame.width ?? 0, needed.width), height: Math.max(frame.height ?? 0, needed.height) };
}

/** A new config for a step already on the canvas; its title follows the config unless the user renamed it. */
function updateStep(nodes: readonly CanvasNode[], step: RecordedBrowserStep): CanvasNode[] {
  return nodes.map((node) => {
    if (node.id !== step.stepId) return node;
    const generated = hasGeneratedLabel(node.data.label, node.data.config);
    return {
      ...node,
      // A new `data` object: auto-save tells edits apart by its identity.
      data: { ...node.data, config: step.config, ...(generated ? { label: recordedStepLabel(step.config) } : {}) },
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
 * keeps its edges and gains one more. A workflow with no End whose anchor
 * leads nowhere gets one with the first step, so it ends Start → steps → End.
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

  const cell = firstFreeCell(nodes.filter((node) => node.parentId === placement.frameId));
  const node: CanvasNode = {
    id: step.stepId,
    type: "browser",
    position: cellPosition(cell),
    parentId: placement.frameId,
    extent: "parent",
    data: { label: recordedStepLabel(step.config), config: step.config },
  };
  const frameId = frame.id;
  nodes = [...nodes.map((candidate) => (candidate.id === frameId ? grownToHold(candidate, cell + 1) : candidate)), node];
  let edges = graph.edges;
  if (inserted.length === 0 && anchor !== undefined) {
    ({ nodes, edges } = withEndAfterFrame({ nodes, edges }, anchor.id, absoluteNodePosition(frame, byId), step.stepId));
  }

  const previous = [...inserted].reverse().find((id) => byId.has(id)) ?? (anchor === undefined ? undefined : anchor.id);
  // Never an edge from a node to itself: a self-loop is what a duplicate id
  // would leave behind, and React Flow cannot run one.
  if (previous === undefined || previous === step.stepId) return { nodes, edges };
  const outgoing = edges.filter((edge) => edge.source === previous);
  const follows = previous !== placement.anchorId || (outgoing.length === 1 && outgoing[0]?.sourceHandle == null) ? outgoing : [];
  const moved = new Set(follows.map((edge) => edge.id));
  return {
    nodes,
    edges: [
      ...edges.map((edge) => (moved.has(edge.id) ? { ...edge, source: step.stepId } : edge)),
      { id: `edge-${step.stepId}`, source: previous, target: step.stepId, type: "custom" },
    ],
  };
}

/**
 * A recording's first step into a workflow with no End gives it one, right of
 * the frame at its widest, led to by the anchor: the splice then yields
 * Start → steps → End, in the same edit as the step. Only when the anchor
 * leads nowhere yet: an anchor with edges of its own already goes somewhere,
 * and an End beside them would be a second branch.
 */
function withEndAfterFrame(graph: CanvasGraph, anchorId: string, frameAt: { x: number; y: number }, stepId: string): CanvasGraph {
  if (graph.nodes.some((node) => node.type === "end") || graph.edges.some((edge) => edge.source === anchorId)) return graph;
  const end: CanvasNode = {
    id: `end-${stepId}`,
    type: "end",
    position: { x: frameAt.x + frameSize(COLUMNS).width + END_GAP_X, y: frameAt.y + GROUP_PAD + FRAME_HEADER },
    data: { label: "End", config: {} },
  };
  return {
    nodes: [...graph.nodes, end],
    edges: [...graph.edges, { id: `edge-${anchorId}-${end.id}`, source: anchorId, target: end.id, type: "custom" }],
  };
}
