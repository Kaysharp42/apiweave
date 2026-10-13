import { useEffect, useRef } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";
import { matchShortcut } from "../constants/keyboardShortcuts";
import type { ShortcutAction } from "../types";

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

const WORKSPACE_ACTIONS: Partial<
  Record<ShortcutAction, keyof ShortcutCallbacks>
> = {
  newWorkflow: "onNewWorkflow",
  closeTab: "onCloseTab",
  nextTab: "onNextTab",
  prevTab: "onPrevTab",
  toggleSidebar: "onToggleSidebar",
  showShortcutsHelp: "onShowShortcutsHelp",
};

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
      const action = matchShortcut(e);
      const name = action === null ? undefined : WORKSPACE_ACTIONS[action];
      if (name === undefined) return;
      e.preventDefault();
      callbacks.current[name]?.();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
