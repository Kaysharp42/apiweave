import type { CanvasNodeTemplate } from "./CanvasNodeTemplate";

export interface CanvasNodeContextMenuProps {
  readonly x: number;
  readonly y: number;
  /** Scopes the saved-preset section; empty string means "no workspace yet". */
  readonly workspaceId: string;
  readonly onSelect: (template: CanvasNodeTemplate) => void;
  readonly onClose: () => void;
}
