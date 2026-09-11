import type { CanvasNodeTemplate } from "./CanvasNodeTemplate";

export interface NodePaletteItem extends CanvasNodeTemplate {
  readonly description: string;
  readonly method?: string;
  readonly presetId?: string;
}
