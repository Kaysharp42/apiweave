import { useEffect, useRef } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";
import type { FocusDirection } from "../types/FocusDirection";

interface UseCanvasKeyboardShortcutsParams {
  isEditorOverlayOpen: boolean;
  isRunning: boolean;
  onSave: () => void;
  onRun: () => void;
  onToggleJsonEditor: () => void;
  /** Move the selection to the nearest node in that direction. */
  onFocusDirection: (direction: FocusDirection) => void;
  onUndo: () => void;
  onRedo: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}

type CanvasShortcutHandlers = UseCanvasKeyboardShortcutsParams;

/**
 * What each chord does, as a table.
 *
 * Returning the handler rather than calling it is what makes `runChord` able to
 * own `preventDefault` — one place decides "this keystroke was ours", so a
 * chord added later cannot forget to claim it. `null` means the chord exists
 * but is unavailable right now, and the keystroke goes back to the browser.
 *
 * Ctrl+Shift+arrow rather than Ctrl+arrow for focus: plain Ctrl+arrow is word
 * navigation on Windows and Linux, which is where this app runs.
 */
type ChordTable = Record<
  string,
  (handlers: CanvasShortcutHandlers) => (() => void) | null
>;

const MODIFIER_CHORDS: ChordTable = {
  s: (h) => h.onSave,
  // Ctrl+R while running keeps its browser meaning rather than doing nothing:
  // no handler, no preventDefault.
  r: (h) => (h.isRunning ? null : h.onRun),
  j: (h) => h.onToggleJsonEditor,
  z: (h) => h.onUndo,
  // Ctrl+Y as well as Ctrl+Shift+Z: this app runs on Windows, where Ctrl+Y is
  // what people's hands already do.
  y: (h) => h.onRedo,
  g: (h) => h.onGroup,
};

const SHIFT_CHORDS: ChordTable = {
  z: (h) => h.onRedo,
  g: (h) => h.onUngroup,
  arrowup: (h) => () => h.onFocusDirection("up"),
  arrowdown: (h) => () => h.onFocusDirection("down"),
  arrowleft: (h) => () => h.onFocusDirection("left"),
  arrowright: (h) => () => h.onFocusDirection("right"),
};

function runChord(
  e: KeyboardEvent,
  table: ChordTable,
  key: string | undefined,
  current: CanvasShortcutHandlers,
): void {
  const action = key === undefined ? undefined : table[key]?.(current);
  if (!action) return;
  e.preventDefault();
  action();
}

/** The shortcut itself, once the guards have decided this keystroke is ours. */
function runCanvasShortcut(
  e: KeyboardEvent,
  current: CanvasShortcutHandlers,
): void {
  const key = e.key?.toLowerCase?.();

  if (key === "f5") {
    e.preventDefault();
    if (!current.isRunning) current.onRun();
    return;
  }

  if (!(e.ctrlKey || e.metaKey)) return;

  runChord(e, e.shiftKey ? SHIFT_CHORDS : MODIFIER_CHORDS, key, current);
}

/**
 * Canvas-scoped keyboard shortcuts (save/run/JSON editor, and Ctrl+Shift+arrow
 * to move the selection between nodes). These live here rather than in the
 * workspace-level `useKeyboardShortcuts` because their handlers —
 * `saveWorkflow`, `runWorkflow`, the JSON editor toggle, the node focus, the
 * undo ring — only exist inside `WorkflowCanvas`.
 *
 * The editor-overlay guard keeps these from firing while a node modal, the JSON
 * editor, or the history/import panels own the keyboard; the editable-target
 * guard lets normal typing (and the JSON editor's own Ctrl+S) win.
 */
export function useCanvasKeyboardShortcuts(
  params: UseCanvasKeyboardShortcutsParams,
) {
  const handlers = useRef<CanvasShortcutHandlers>(params);

  useEffect(() => {
    handlers.current = params;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const current = handlers.current;
      if (e.defaultPrevented || current.isEditorOverlayOpen) return;
      if (isEditableKeyboardTarget(e.target)) return;

      runCanvasShortcut(e, current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
