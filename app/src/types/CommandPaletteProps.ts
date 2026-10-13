import type { CanvasCommand } from "./CanvasCommand";

export interface CommandPaletteProps {
  open: boolean;
  commands: readonly CanvasCommand[];
  /** Workflows and nodes of this workspace are searched too; null searches commands only. */
  workspaceId: string | null;
  onClose: () => void;
}
