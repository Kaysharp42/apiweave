import type { KeyChord, KeyboardShortcut, ShortcutAction } from "../types";

/**
 * Every keyboard shortcut in the app. The handlers match key events against
 * this table and the help dialog, command palette and hints print it, so a
 * shortcut cannot work without being listed or be listed without working.
 */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  {
    action: "newWorkflow",
    group: "General",
    description: "New workflow",
    chords: [{ key: "n", modifier: "mod" }],
  },
  {
    action: "save",
    group: "General",
    description: "Save workflow",
    chords: [{ key: "s", modifier: "mod" }],
  },
  {
    action: "run",
    group: "General",
    description: "Run workflow",
    chords: [{ key: "r", modifier: "mod" }, { key: "f5" }],
  },
  {
    action: "openCommandPalette",
    group: "General",
    description: "Open command palette",
    chords: [{ key: "k", modifier: "mod" }],
  },
  {
    action: "showShortcutsHelp",
    group: "General",
    description: "Show keyboard shortcuts",
    chords: [{ key: "?" }],
  },
  {
    action: "closeTab",
    group: "Tabs",
    description: "Close active tab",
    chords: [{ key: "w", modifier: "mod" }],
  },
  // Control, not ⌘, on macOS too: ⌘Tab belongs to the OS app switcher.
  {
    action: "nextTab",
    group: "Tabs",
    description: "Next tab",
    chords: [{ key: "tab", modifier: "ctrl" }],
  },
  {
    action: "prevTab",
    group: "Tabs",
    description: "Previous tab",
    chords: [{ key: "tab", modifier: "ctrl", shift: true }],
  },
  {
    action: "toggleSidebar",
    group: "Panels",
    description: "Toggle sidebar",
    chords: [{ key: "b", modifier: "mod" }],
  },
  {
    action: "toggleJsonEditor",
    group: "Panels",
    description: "Toggle JSON editor",
    chords: [{ key: "j", modifier: "mod" }],
  },
  {
    action: "undo",
    group: "Canvas",
    description: "Undo",
    chords: [{ key: "z", modifier: "mod" }],
  },
  // Ctrl+Y as well: on Windows it is what people's hands already do.
  {
    action: "redo",
    group: "Canvas",
    description: "Redo",
    chords: [
      { key: "z", modifier: "mod", shift: true },
      { key: "y", modifier: "mod" },
    ],
  },
  {
    action: "copy",
    group: "Canvas",
    description: "Copy selected nodes",
    chords: [{ key: "c", modifier: "mod" }],
  },
  {
    action: "paste",
    group: "Canvas",
    description: "Paste nodes",
    chords: [{ key: "v", modifier: "mod" }],
  },
  {
    action: "duplicate",
    group: "Canvas",
    description: "Duplicate selected nodes",
    chords: [{ key: "d", modifier: "mod" }],
  },
  // Handled by React Flow (`deleteKeyCode`); the Mac delete key sends Backspace.
  {
    action: "delete",
    group: "Canvas",
    description: "Delete selected nodes",
    chords: [{ key: "delete" }, { key: "backspace" }],
  },
  {
    action: "group",
    group: "Canvas",
    description: "Group selected nodes",
    chords: [{ key: "g", modifier: "mod" }],
  },
  {
    action: "ungroup",
    group: "Canvas",
    description: "Ungroup selected frame",
    chords: [{ key: "g", modifier: "mod", shift: true }],
  },
  // Shift as well: plain Ctrl+arrow is word navigation on Windows and Linux.
  {
    action: "focusUp",
    group: "Canvas",
    description: "Select the node above",
    chords: [{ key: "arrowup", modifier: "mod", shift: true }],
  },
  {
    action: "focusDown",
    group: "Canvas",
    description: "Select the node below",
    chords: [{ key: "arrowdown", modifier: "mod", shift: true }],
  },
  {
    action: "focusLeft",
    group: "Canvas",
    description: "Select the node to the left",
    chords: [{ key: "arrowleft", modifier: "mod", shift: true }],
  },
  {
    action: "focusRight",
    group: "Canvas",
    description: "Select the node to the right",
    chords: [{ key: "arrowright", modifier: "mod", shift: true }],
  },
];

/** Read per call rather than at load, so a test can stand in for macOS. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}

/** The platform's primary modifier: ⌘ on macOS, Ctrl elsewhere — never both. */
export function isPrimaryModifier(event: KeyboardEvent): boolean {
  return isMac()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function modifierMatches(event: KeyboardEvent, chord: KeyChord): boolean {
  if (chord.modifier === "mod") return isPrimaryModifier(event);
  if (chord.modifier === "ctrl") return event.ctrlKey && !event.metaKey;
  return !event.ctrlKey && !event.metaKey;
}

/**
 * The key a chord is compared with. A non-Latin layout types a non-ASCII
 * character (Ctrl+N is "т" on Cyrillic), so that falls back to the physical
 * key; anything ASCII keeps matching by character, which is what keeps AZERTY
 * and Dvorak right — and "?" on AZERTY, whose physical key is `KeyM`.
 */
function eventKey(event: KeyboardEvent): string | undefined {
  const key = event.key?.toLowerCase();
  const code = event.code ?? "";
  if (
    /^(?:Key[A-Z]|Digit[0-9])$/.test(code) &&
    key?.length === 1 &&
    key.charCodeAt(0) > 127
  ) {
    return code.slice(-1).toLowerCase();
  }
  return key;
}

function chordMatches(event: KeyboardEvent, chord: KeyChord): boolean {
  if (event.altKey || eventKey(event) !== chord.key) return false;
  // "?" already took Shift to type; its key value says so.
  const shiftMatches =
    chord.key === "?" || Boolean(event.shiftKey) === Boolean(chord.shift);
  return shiftMatches && modifierMatches(event, chord);
}

/** The action a key event triggers, or null. */
export function matchShortcut(event: KeyboardEvent): ShortcutAction | null {
  const match = KEYBOARD_SHORTCUTS.find((shortcut) =>
    shortcut.chords.some((chord) => chordMatches(event, chord)),
  );
  return match?.action ?? null;
}

const KEY_NAMES: Record<string, string> = {
  tab: "Tab",
  f5: "F5",
  delete: "Delete",
  backspace: "Backspace",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** The keys of a chord as the platform names them, e.g. ["⌘", "⇧", "Z"]. */
export function chordKeys(chord: KeyChord): string[] {
  const keys: string[] = [];
  if (chord.modifier === "mod") keys.push(isMac() ? "⌘" : "Ctrl");
  if (chord.modifier === "ctrl") keys.push(isMac() ? "⌃" : "Ctrl");
  if (chord.shift) keys.push(isMac() ? "⇧" : "Shift");
  keys.push(KEY_NAMES[chord.key] ?? chord.key.toUpperCase());
  return keys;
}

/** The keys of an action's primary chord. */
export function shortcutKeys(action: ShortcutAction): string[] {
  const chord = KEYBOARD_SHORTCUTS.find((s) => s.action === action)?.chords[0];
  return chord ? chordKeys(chord) : [];
}

/** An action's primary chord as one label: "⌘S" on macOS, "Ctrl+S" elsewhere. */
export function shortcutLabel(action: ShortcutAction): string {
  return shortcutKeys(action).join(isMac() ? "" : "+");
}
