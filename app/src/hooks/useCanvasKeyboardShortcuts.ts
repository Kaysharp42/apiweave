import { useEffect, useRef } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";

interface UseCanvasKeyboardShortcutsParams {
  isEditorOverlayOpen: boolean;
  isRunning: boolean;
  onSave: () => void;
  onRun: () => void;
  onToggleJsonEditor: () => void;
}

interface CanvasShortcutHandlers {
  isEditorOverlayOpen: boolean;
  isRunning: boolean;
  onSave: () => void;
  onRun: () => void;
  onToggleJsonEditor: () => void;
}

/** The Ctrl/⌘ chords the canvas owns. */
function runModifierChord(
  e: KeyboardEvent,
  key: string | undefined,
  current: CanvasShortcutHandlers,
): void {
  if (key === "s") {
    e.preventDefault();
    current.onSave();
    return;
  }
  if (key === "r") {
    if (current.isRunning) return;
    e.preventDefault();
    current.onRun();
    return;
  }
  if (key === "j") {
    e.preventDefault();
    current.onToggleJsonEditor();
  }
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

  if (e.ctrlKey || e.metaKey) runModifierChord(e, key, current);
}

/**
 * Canvas-scoped keyboard shortcuts (save/run/JSON editor). These live here
 * rather than in the workspace-level `useKeyboardShortcuts` because their
 * handlers — `saveWorkflow`, `runWorkflow`, the JSON editor toggle — only exist
 * inside `WorkflowCanvas`.
 *
 * The editor-overlay guard keeps these from firing while a node modal, the JSON
 * editor, or the history/import panels own the keyboard; the editable-target
 * guard lets normal typing (and the JSON editor's own Ctrl+S) win.
 */
export function useCanvasKeyboardShortcuts({
  isEditorOverlayOpen,
  isRunning,
  onSave,
  onRun,
  onToggleJsonEditor,
}: UseCanvasKeyboardShortcutsParams) {
  const handlers = useRef<CanvasShortcutHandlers>({
    isEditorOverlayOpen,
    isRunning,
    onSave,
    onRun,
    onToggleJsonEditor,
  });

  useEffect(() => {
    handlers.current = {
      isEditorOverlayOpen,
      isRunning,
      onSave,
      onRun,
      onToggleJsonEditor,
    };
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
