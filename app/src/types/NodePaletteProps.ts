import type { NodePaletteItem } from "./NodePaletteItem";

export interface NodePaletteProps {
  readonly workspaceId: string;
  readonly onDragStart?: () => void;
  /** Click-to-add; the same items are also draggable onto the canvas. */
  readonly onSelect: (node: NodePaletteItem) => void;
  readonly autoFocusFilter?: boolean;
}
