import type { NodeEditorSteps } from "./NodeEditorSteps";
import type { NodeModalNodeType } from "./NodeModalNodeType";

export interface NodeModalTitleBarProps {
  readonly nodeId: string;
  readonly nodeType: NodeModalNodeType;
  readonly nodeLabel: string;
  readonly onLabelChange: (newLabel: string) => void;
  readonly onClose: () => void;
  readonly steps: NodeEditorSteps;
  readonly nameRef: (element: HTMLElement | null) => void;
}
