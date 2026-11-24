import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasNode } from "./CanvasNode";
import type { MakeStepVariableChoice } from "./MakeStepVariableChoice";

export interface MakeStepVariableDialogProps {
  readonly open: boolean;
  /** The step the dialog is open for. */
  readonly node: CanvasNode | undefined;
  /** Every node on the canvas, to count the other steps holding the same text. */
  readonly nodes: readonly CanvasNode[];
  readonly variables: Readonly<Record<string, JsonValue>>;
  readonly onClose: () => void;
  readonly onSubmit: (choice: MakeStepVariableChoice) => void;
}
