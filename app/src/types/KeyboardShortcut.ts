import type { KeyChord } from "./KeyChord";
import type { ShortcutAction } from "./ShortcutAction";

export interface KeyboardShortcut {
  action: ShortcutAction;
  group: "General" | "Tabs" | "Panels" | "Canvas" | "Node editor";
  description: string;
  /** The first chord is the one labels show; the rest are alternatives. */
  chords: readonly KeyChord[];
}
