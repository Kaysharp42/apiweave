import { useEffect, useRef } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";
import type { FocusDirection } from "../types/FocusDirection";
import type { ShortcutAction } from "../types";
import { matchShortcut } from "../constants/keyboardShortcuts";

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
  onOpenCommandPalette: () => void;
}

type CanvasShortcutHandlers = UseCanvasKeyboardShortcutsParams;

/**
 * What each canvas action does. Returning the handler rather than calling it
 * lets the listener own `preventDefault` — one place decides "this keystroke
 * was ours". `null` means the action is unavailable right now, and the
 * keystroke goes back to the browser.
 */
const CANVAS_ACTIONS: Partial<
  Record<ShortcutAction, (h: CanvasShortcutHandlers) => (() => void) | null>
> = {
  save: (h) => h.onSave,
  // Run while running is unavailable: no handler, no preventDefault.
  run: (h) => (h.isRunning ? null : h.onRun),
  toggleJsonEditor: (h) => h.onToggleJsonEditor,
  openCommandPalette: (h) => h.onOpenCommandPalette,
  undo: (h) => h.onUndo,
  redo: (h) => h.onRedo,
  group: (h) => h.onGroup,
  ungroup: (h) => h.onUngroup,
  focusUp: (h) => () => h.onFocusDirection("up"),
  focusDown: (h) => () => h.onFocusDirection("down"),
  focusLeft: (h) => () => h.onFocusDirection("left"),
  focusRight: (h) => () => h.onFocusDirection("right"),
};

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

      const action = matchShortcut(e);
      const run = action === null ? null : CANVAS_ACTIONS[action]?.(current);
      if (!run) return;
      e.preventDefault();
      run();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
