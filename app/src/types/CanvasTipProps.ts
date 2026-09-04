import type { CanvasTipDefinition } from "./CanvasTipDefinition";

export interface CanvasTipProps {
  tip: CanvasTipDefinition;
  shortcut: string | null;
  onDismiss: () => void;
}
