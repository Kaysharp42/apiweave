import type { MutableRefObject } from "react";
import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasNode } from "./CanvasNode";

export interface UseMakeStepVariableParams {
  /** The canvas's latest nodes, which a save reads; updated before `setNodes` like every other programmatic edit. */
  readonly nodesRef: MutableRefObject<CanvasNode[]>;
  readonly setNodes: (nodes: CanvasNode[]) => void;
  /** The workflow variables, from WorkflowContext. */
  readonly variables: Readonly<Record<string, JsonValue>>;
  /** WorkflowContext's `updateVariable`. */
  readonly setVariable: (name: string, value: JsonValue) => void;
}
