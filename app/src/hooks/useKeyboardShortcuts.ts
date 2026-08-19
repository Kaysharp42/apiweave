import { useEffect, useRef } from "react";
import Mousetrap from "mousetrap";

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

    const call =
      (name: keyof ShortcutCallbacks) =>
      (e: Mousetrap.ExtendedKeyboardEvent) => {
        e.preventDefault();
        callbacks.current[name]?.();
      };

    Mousetrap.bind("ctrl+n", call("onNewWorkflow"));
    Mousetrap.bind("ctrl+w", call("onCloseTab"));
    Mousetrap.bind("ctrl+tab", call("onNextTab"));
    Mousetrap.bind("ctrl+shift+tab", call("onPrevTab"));
    Mousetrap.bind("ctrl+b", call("onToggleSidebar"));
    Mousetrap.bind("?", (e: Mousetrap.ExtendedKeyboardEvent) => {
      const tag = e.target
        ? (e.target as HTMLElement).tagName.toLowerCase()
        : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      callbacks.current.onShowShortcutsHelp?.();
    });

    return () => {
      Mousetrap.unbind("ctrl+n");
      Mousetrap.unbind("ctrl+w");
      Mousetrap.unbind("ctrl+tab");
      Mousetrap.unbind("ctrl+shift+tab");
      Mousetrap.unbind("ctrl+b");
      Mousetrap.unbind("?");
    };
  }, [enabled]);
}
