import type { CanvasTipContext } from "./CanvasTipContext";

export interface CanvasTipDefinition {
  id: string;
  text: string;
  chord?: string;
  when: (context: CanvasTipContext) => boolean;
}
