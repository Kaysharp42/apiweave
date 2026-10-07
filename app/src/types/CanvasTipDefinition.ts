import type { CanvasTipContext } from "./CanvasTipContext";
import type { ShortcutAction } from "./ShortcutAction";

export interface CanvasTipDefinition {
  id: string;
  text: string;
  chord?: ShortcutAction;
  when: (context: CanvasTipContext) => boolean;
}
