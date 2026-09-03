import type { CanvasCommand } from "./CanvasCommand";

export interface CommandPaletteProps {
  open: boolean;
  commands: readonly CanvasCommand[];
  onClose: () => void;
}
