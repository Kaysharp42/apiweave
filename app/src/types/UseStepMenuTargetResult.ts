import type { CanvasNode } from "./CanvasNode";

export interface UseStepMenuTargetResult {
  /** The step a menu action's dialog is open for, or null when it is closed. */
  readonly nodeId: string | null;
  /** That step, or undefined when the dialog is closed or the step is gone. */
  readonly node: CanvasNode | undefined;
  /** Whether the step menu offers the action for this node. */
  readonly can: (id: string) => boolean;
  /** Open the dialog for a step. */
  readonly start: (id: string) => void;
  /** Close the dialog. */
  readonly close: () => void;
  /** Close the dialog and return the step it was open for, to act on. */
  readonly take: () => string | null;
}
