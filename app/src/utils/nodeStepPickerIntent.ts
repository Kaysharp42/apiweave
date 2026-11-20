import { matchShortcut } from "../constants/keyboardShortcuts";
import type { NodeStepDirection } from "../types/NodeStepDirection";
import type { NodeStepPickerIntent } from "../types/NodeStepPickerIntent";

const MOVES: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * What a key press means while a step picker is open, or null for a key the
 * picker leaves alone. The picker's own arrow takes the highlighted branch, so
 * following a run is the same key over and over; the opposite arrow backs out.
 */
export function nodeStepPickerIntent(
  event: KeyboardEvent,
  direction: NodeStepDirection,
  count: number,
): NodeStepPickerIntent | null {
  const shortcut = matchShortcut(event);
  const own = direction === "next" ? "nextNode" : "previousNode";
  const opposite = direction === "next" ? "previousNode" : "nextNode";
  if (event.key === "Escape" || shortcut === opposite) return { kind: "close" };
  if (event.key === "Enter" || shortcut === own) return { kind: "take" };
  const by = MOVES[event.key];
  if (by !== undefined) return { kind: "move", by };
  const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
  return index >= 0 && index < count ? { kind: "pick", index } : null;
}
