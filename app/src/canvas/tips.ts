import type { CanvasTipContext } from "../types/CanvasTipContext";
import type { CanvasTipDefinition } from "../types/CanvasTipDefinition";

const canvasTips: readonly CanvasTipDefinition[] = [
  {
    id: "group-selection",
    text: "Frame this selection",
    chord: "group",
    when: (context) => context.canGroup,
  },
  {
    id: "ungroup-selection",
    text: "Release this frame",
    chord: "ungroup",
    when: (context) => context.canUngroup,
  },
  {
    id: "undo",
    text: "Undo your last canvas change",
    chord: "undo",
    when: (context) => context.canUndo,
  },
  {
    id: "connect-node",
    text: "Drag from a handle to connect this node",
    when: (context) => context.hasUnconnectedNode,
  },
];

/** The highest-priority eligible tip that has not been dismissed. */
export function selectCanvasTip(
  context: CanvasTipContext,
  dismissed: ReadonlySet<string>,
): CanvasTipDefinition | null {
  if (context.isRunning) return null;
  return (
    canvasTips.find(
      (tip) => !dismissed.has(tip.id) && tip.when(context),
    ) ?? null
  );
}
