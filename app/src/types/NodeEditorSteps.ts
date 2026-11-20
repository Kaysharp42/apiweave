import type { NodeStep } from "./NodeStep";
import type { NodeStepDirection } from "./NodeStepDirection";

/** Where the node editor can step from the node it shows, and how it got there. */
export interface NodeEditorSteps {
  /** The node the editor came from, or every incoming edge when it was opened here. */
  readonly previous: readonly NodeStep[];
  /** One per outgoing edge: several at a fork. */
  readonly next: readonly NodeStep[];
  /**
   * How the editor reached this node, if by a step. Focus then goes to that
   * step button rather than the name field, so the next bare arrow press steps
   * again instead of moving the caret.
   */
  readonly arrivedBy: NodeStepDirection | null;
  readonly onStep: (direction: NodeStepDirection, step: NodeStep) => void;
}
