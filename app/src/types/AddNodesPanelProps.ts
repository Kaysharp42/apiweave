import type { CanvasNodeTemplate } from "./CanvasNodeTemplate";

export interface AddNodesPanelProps {
  isModalOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
  /** Scopes the saved-preset section; empty string means "no workspace yet", and the section is hidden. */
  workspaceId?: string;
  /** Click-to-add from the palette; drops the node at the canvas centre. */
  onAddNode?: (template: CanvasNodeTemplate) => void;
}
