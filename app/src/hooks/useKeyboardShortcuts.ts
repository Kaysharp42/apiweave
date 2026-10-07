import { useEffect, useRef } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";

interface UseKeyboardShortcutsParams {
  /**
   * False while the surface these shortcuts belong to is covered. The canvas
   * stays mounted behind a page route so its state survives the trip, and a
   * hidden canvas must not answer Ctrl+W or Ctrl+N on that page's behalf.
   */
  enabled?: boolean;
  onNewWorkflow?: () => void;
  onCloseTab?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onToggleSidebar?: () => void;
  onShowShortcutsHelp?: () => void;
}

interface ShortcutCallbacks {
  onNewWorkflow?: (() => void) | undefined;
  onCloseTab?: (() => void) | undefined;
  onNextTab?: (() => void) | undefined;
  onPrevTab?: (() => void) | undefined;
  onToggleSidebar?: (() => void) | undefined;
  onShowShortcutsHelp?: (() => void) | undefined;
}

/** Ctrl, not Cmd, on every OS, and no other modifier unless the combo names it. */
function shortcutFor(e: KeyboardEvent): keyof ShortcutCallbacks | null {
  if (e.altKey || e.metaKey) return null;
  if (!e.ctrlKey) return e.key === "?" ? "onShowShortcutsHelp" : null;
  if (e.key === "Tab") return e.shiftKey ? "onPrevTab" : "onNextTab";
  if (e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case "n":
      return "onNewWorkflow";
    case "w":
      return "onCloseTab";
    case "b":
      return "onToggleSidebar";
    default:
      return null;
  }
}

export default function useKeyboardShortcuts({
  enabled = true,
  onNewWorkflow,
  onCloseTab,
  onNextTab,
  onPrevTab,
  onToggleSidebar,
  onShowShortcutsHelp,
}: UseKeyboardShortcutsParams = {}) {
  const callbacks = useRef<ShortcutCallbacks>({});

  useEffect(() => {
    callbacks.current = {
      onNewWorkflow,
      onCloseTab,
      onNextTab,
      onPrevTab,
      onToggleSidebar,
      onShowShortcutsHelp,
    };
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Typing belongs to the field, shortcuts included.
      if (
        isEditableKeyboardTarget(e.target) ||
        (e.target as Element | null)?.tagName === "SELECT"
      ) {
        return;
      }
      const name = shortcutFor(e);
      if (name === null) return;
      e.preventDefault();
      callbacks.current[name]?.();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
