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
      if (e.defaultPrevented || handlers.current.isEditorOverlayOpen) return;
      if (isEditableKeyboardTarget(e.target)) return;

      const key = e.key?.toLowerCase?.();

      if (key === "f5") {
        e.preventDefault();
        if (!handlers.current.isRunning) handlers.current.onRun();
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;

      if (key === "s") {
        e.preventDefault();
        handlers.current.onSave();
      } else if (key === "r") {
        if (handlers.current.isRunning) return;
        e.preventDefault();
        handlers.current.onRun();
      } else if (key === "j") {
        e.preventDefault();
        handlers.current.onToggleJsonEditor();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
