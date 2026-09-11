import type { LucideIcon } from "lucide-react";
import type { NodePaletteItem } from "./NodePaletteItem";

export interface NodePaletteSection {
  readonly key: string;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly nodes: readonly NodePaletteItem[];
}
