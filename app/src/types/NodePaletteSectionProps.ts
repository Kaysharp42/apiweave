import type { DragEvent } from "react";
import type { NodePaletteItem } from "./NodePaletteItem";
import type { NodePaletteSection } from "./NodePaletteSection";

export interface NodePaletteSectionProps {
  readonly section: NodePaletteSection;
  readonly onDragStart: (event: DragEvent, node: NodePaletteItem) => void;
  readonly onSelect: (node: NodePaletteItem) => void;
  readonly onRenamePreset: (
    presetId: string,
    name: string,
    previous: string,
  ) => void;
  readonly onDeletePreset: (presetId: string, name: string) => void;
  readonly defaultOpen: boolean;
}
